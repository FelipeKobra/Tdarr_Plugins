/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: "Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC",
  Stage: "Pre-processing",
  Name: "FelipeKbra - H264/HEVC to NVENC (Fixed Bitrate)",
  Type: "Video",
  Operation: "Transcode",
  Description: `Fixed version with proper bitrate reduction and CQ settings per resolution.
    - Uses tiered CQ values (22-26) instead of fixed 19
    - Improved bitrate calculation to actually reduce file size
    - Proper HEVC reconvert filters
    - Better skip logic for already processed files`,
  Version: "5.0",
  Tags: "pre-processing,ffmpeg,nvenc h265, hdr, hvc1, size filter",
  Inputs: [
    {
      name: "min_file_size_mb",
      type: "number",
      defaultValue: 7000,
      inputUI: { type: "text" },
      tooltip: "Skip processing if file size (MB) is below this value.",
    },
    {
      name: "target_bitrate_480p576p",
      type: "number",
      defaultValue: 1000,
      inputUI: { type: "text" },
      tooltip: "Target bitrate in kbps for 480p/576p.",
    },
    {
      name: "target_bitrate_720p",
      type: "number",
      defaultValue: 2000,
      inputUI: { type: "text" },
      tooltip: "Target bitrate in kbps for 720p.",
    },
    {
      name: "target_bitrate_1080p",
      type: "number",
      defaultValue: 4000,
      inputUI: { type: "text" },
      tooltip: "Target bitrate in kbps for 1080p.",
    },
    {
      name: "target_bitrate_4KUHD",
      type: "number",
      defaultValue: 8000,
      inputUI: { type: "text" },
      tooltip: "Target bitrate in kbps for 4KUHD.",
    },
    {
      name: "target_pct_reduction",
      type: "number",
      defaultValue: 0.5,
      inputUI: { type: "text" },
      tooltip: "Reduction percentage when current bitrate < target (0.5 = 50% of current).",
    },
    {
      name: "hevc_480p_576p_filter_bitrate",
      type: "number",
      defaultValue: 2000,
      inputUI: { type: "text" },
      tooltip: "Only reconvert HEVC 480p/576p if ABOVE this bitrate (kbps).",
    },
    {
      name: "hevc_720p_filter_bitrate",
      type: "number",
      defaultValue: 3000,
      inputUI: { type: "text" },
      tooltip: "Only reconvert HEVC 720p if ABOVE this bitrate (kbps).",
    },
    {
      name: "hevc_1080p_filter_bitrate",
      type: "number",
      defaultValue: 6000,
      inputUI: { type: "text" },
      tooltip: "Only reconvert HEVC 1080p if ABOVE this bitrate (kbps).",
    },
    {
      name: "hevc_filter_bitrate_4KUHD",
      type: "number",
      defaultValue: 10000,
      inputUI: { type: "text" },
      tooltip: "Only reconvert HEVC 4K if ABOVE this bitrate (kbps).",
    },
    {
      name: "nvenc_preset",
      type: "string",
      defaultValue: "p5",
      inputUI: {
        type: "dropdown",
        options: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      },
      tooltip: "NVENC preset. p4 recommended for FFmpeg 7+ (good quality/speed balance).",
    },
    {
      name: "bframes",
      type: "boolean",
      defaultValue: true,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Enables bframes. Requires NVIDIA Turing+ architecture.",
    },
    {
      name: "reconvert_hevc",
      type: "boolean",
      defaultValue: true,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Reconvert HEVC files above bitrate filter thresholds.",
    },
    {
      name: "keep_hdr",
      type: "boolean",
      defaultValue: false,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Keep HDR metadata (true) or tonemap to SDR (false).",
    },
    {
      name: "tagName",
      type: "string",
      defaultValue: "comment",
      inputUI: { type: "text" },
      tooltip: "Metadata tag to mark processed files",
    },
    {
      name: "tagValues",
      type: "string",
      defaultValue: "processed",
      inputUI: { type: "text" },
      tooltip: "Tag value for processed files",
    }
  ],
});

class Log {
  constructor() { this.entries = []; }
  Phase(num, title) { this.entries.push(`\n--- PHASE [${num}]: ${title} ---`); }
  Add(entry) { this.entries.push(`[INFO] ${entry}`); }
  AddSuccess(entry) { this.entries.push(`☑ [SUCCESS] ${entry}`); }
  AddWarning(entry) { this.entries.push(`⚠ [WARNING] ${entry}`); }
  AddError(entry) { this.entries.push(`☒ [ERROR] ${entry}`); }
  GetLogData() { return this.entries.join("\n"); }
}

function calculateBitrate(file) {
  let bitrateProbe = file.ffProbeData.streams[0].bit_rate;
  if (isNaN(bitrateProbe)) bitrateProbe = file.bit_rate;
  return bitrateProbe;
}

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require("../methods/lib")();
  inputs = lib.loadDefaultValues(inputs, details);
  const logger = new Log();
  
  const response = {
    container: `.${file.container}`,
    FFmpegMode: true,
    infoLog: "",
    processFile: false,
    preset: "",
    reQueueAfter: true,
  };

  // --- STAGE 1: INITIAL VALIDATION ---
  logger.Phase(1, "INITIAL VALIDATION");
  if (file.fileMedium !== "video") {
    logger.AddError("File is not a video. Aborting.");
    response.infoLog = logger.GetLogData();
    return response;
  }
  logger.Add(`File: ${file.file_name}`);
  logger.Add(`Container: ${file.container}`);

  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  if (!videoStream) {
    logger.AddError("No valid video stream found.");
    response.infoLog = logger.GetLogData();
    return response;
  }

  // --- STAGE 2: CODEC & METADATA ANALYSIS ---
  logger.Phase(2, "CODEC & METADATA ANALYSIS");
  const currentCodec = videoStream.codec_name;
  const currentTag = videoStream.codec_tag_string || "none";
  const hasProcessedTag = file.ffProbeData.format?.tags?.[inputs.tagName] === inputs.tagValues;
  
  logger.Add(`Codec: ${currentCodec} | Tag: ${currentTag}`);
  if (hasProcessedTag) logger.Add(`Processing tag found: ${inputs.tagName}=${inputs.tagValues}`);

  // HDR Detection
  const hdrTransferFunctions = ['smpte2084', 'arib-std-b67'];
  let isHDR = videoStream.color_trc && hdrTransferFunctions.includes(videoStream.color_trc);
  if (!isHDR && videoStream.side_data_list) {
    isHDR = videoStream.side_data_list.some(data => data.side_data_type === 'DOVI configuration record');
  }
  logger.Add(`HDR: ${isHDR ? "YES" : "NO"}`);

  // HEVC Skip Logic
  if (currentCodec === 'hevc' && currentTag === 'hvc1') {
    if (hasProcessedTag && !inputs.reconvert_hevc) {
      logger.AddSuccess("HEVC/hvc1 already processed and reconvert is OFF. Skipping.");
      response.infoLog = logger.GetLogData();
      return response;
    }
    if (!inputs.reconvert_hevc) {
      logger.AddSuccess("HEVC/hvc1 and reconvert is OFF. Skipping.");
      response.infoLog = logger.GetLogData();
      return response;
    }
  }

  // --- STAGE 3: BITRATE FILTERING ---
  logger.Phase(3, "BITRATE & SIZE FILTERING");
  const fileSizeMB = file.file_size;
  if (inputs.min_file_size_mb > 0 && fileSizeMB < inputs.min_file_size_mb) {
    logger.AddWarning(`File size ${Math.round(fileSizeMB)}MB below minimum ${inputs.min_file_size_mb}MB.`);
    if (currentCodec === 'hevc' && currentTag === 'hvc1') {
      logger.AddSuccess("Small HEVC file is healthy. Skipping.");
      response.infoLog = logger.GetLogData();
      return response;
    }
  }

  // Current bitrate calculation
  const currentBitrateKbps = calculateBitrate(file) / 1000;
  logger.Add(`Current Bitrate: ${Math.round(currentBitrateKbps)}kbps`);

  // Resolution-based targets and CQ values
  const resolutionConfig = {
    "480p": { 
      targetBitrate: inputs.target_bitrate_480p576p,
      hevcFilter: inputs.hevc_480p_576p_filter_bitrate,
      cq: 22,
      maxIncrease: 100
    },
    "576p": { 
      targetBitrate: inputs.target_bitrate_480p576p,
      hevcFilter: inputs.hevc_480p_576p_filter_bitrate,
      cq: 22,
      maxIncrease: 100
    },
    "720p": { 
      targetBitrate: inputs.target_bitrate_720p,
      hevcFilter: inputs.hevc_720p_filter_bitrate,
      cq: 23,
      maxIncrease: 200
    },
    "1080p": { 
      targetBitrate: inputs.target_bitrate_1080p,
      hevcFilter: inputs.hevc_1080p_filter_bitrate,
      cq: 24,
      maxIncrease: 400
    },
    "4KUHD": { 
      targetBitrate: inputs.target_bitrate_4KUHD,
      hevcFilter: inputs.hevc_filter_bitrate_4KUHD,
      cq: 26,
      maxIncrease: 400
    },
  };

  const config = resolutionConfig[file.video_resolution] || resolutionConfig["1080p"];
  logger.Add(`Resolution: ${file.video_resolution}`);
  logger.Add(`Target Bitrate (baseline): ${config.targetBitrate}kbps`);
  logger.Add(`CQ Value: ${config.cq}`);

  // HEVC Reconvert Filter
  if (currentCodec === 'hevc' && inputs.reconvert_hevc) {
    const hevcFilterKbps = config.hevcFilter;
    if (hevcFilterKbps > 0 && file.bit_rate < hevcFilterKbps * 1000) {
      logger.AddSuccess(`HEVC bitrate ${Math.round(file.bit_rate/1000)}kbps is below filter ${hevcFilterKbps}kbps. Skipping.`);
      response.infoLog = logger.GetLogData();
      return response;
    }
    logger.Add(`HEVC bitrate ${Math.round(file.bit_rate/1000)}kbps is above filter ${hevcFilterKbps}kbps. Will reconvert.`);
  }

  // Calculate actual target bitrate
  let targetBitrate;
  if (currentBitrateKbps < config.targetBitrate) {
    // Current is lower than target - reduce it further
    targetBitrate = Math.round(currentBitrateKbps * inputs.target_pct_reduction);
    logger.Add(`Current < Target: Using ${inputs.target_pct_reduction * 100}% of current = ${targetBitrate}kbps`);
  } else {
    // Current is higher than target - use target
    targetBitrate = config.targetBitrate;
    logger.Add(`Current >= Target: Using target = ${targetBitrate}kbps`);
  }

  const maxBitrate = targetBitrate + config.maxIncrease;
  logger.Add(`Max Bitrate: ${maxBitrate}kbps (target + ${config.maxIncrease})`);

  // Sanity check - don't increase bitrate
  if (targetBitrate >= currentBitrateKbps * 0.9) {
    logger.AddWarning(`Calculated target (${targetBitrate}kbps) is not significantly lower than current (${Math.round(currentBitrateKbps)}kbps).`);
    if (currentCodec === 'hevc' && currentTag === 'hvc1' && hasProcessedTag) {
      logger.AddSuccess("HEVC file already processed and bitrate is acceptable. Skipping.");
      response.infoLog = logger.GetLogData();
      return response;
    }
  }

  // --- STAGE 4: HARDWARE ACCELERATION ---
  logger.Phase(4, "HARDWARE ACCELERATION SETUP");
  const { getNvdecHwaccelPreset } = require('../methods/nvdecPreset');
  const nvencDecodeOptions = { softwareFrames: true }; 
  const hwaccel = getNvdecHwaccelPreset(file, nvencDecodeOptions);
  
  if (hwaccel) {
    logger.AddSuccess(`Hardware acceleration enabled`);
  } else {
    logger.AddWarning("Hardware acceleration not available, using CPU decode.");
  }

  // --- STAGE 5: ENCODER PARAMETERS ---
  logger.Phase(5, "ENCODER COMMAND ASSEMBLY");
  
  let videoOptions = `-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le `;
  videoOptions += `-preset ${inputs.nvenc_preset} -cq:v ${config.cq} `;
  videoOptions += `-b:v ${targetBitrate}k -maxrate:v ${maxBitrate}k -bufsize ${targetBitrate * 2}k `;
  videoOptions += `-spatial_aq:v 1 -rc-lookahead:v 32 `;
  videoOptions += `-metadata ${inputs.tagName}=${inputs.tagValues} `;

  // HDR / Tonemapping
  if (isHDR && !inputs.keep_hdr) {
    logger.Add("Adding HDR→SDR tonemapping (CUDA filters).");
    videoOptions += '-vf "tonemap_cuda=t=bt709:m=bt709:p=bt709:format=p010le" ';
    videoOptions += '-colorspace bt709 -color_primaries bt709 -color_trc bt709 ';
  } else if (isHDR) {
    logger.Add("Preserving HDR metadata.");
    videoOptions += '-colorspace bt2020nc -color_primaries bt2020 -color_trc smpte2084 ';
  }

  // B-Frames
  if (inputs.bframes) {
    logger.Add("B-Frames enabled (-bf 5).");
    videoOptions += "-bf 5 ";
  }

  // Faststart for MP4
  let movFlags = "";
  if (file.container.toLowerCase() === 'mp4' || response.container.toLowerCase() === '.mp4') {
    logger.Add("MP4 container: Adding -movflags +faststart.");
    movFlags = "-movflags +faststart ";
  }

  response.processFile = true;
  response.preset = `${hwaccel}, -threads 1 -fflags +genpts -map 0 ${videoOptions} -c:a copy -c:s copy ${movFlags}-max_muxing_queue_size 9999`;

  logger.AddSuccess("FFmpeg command built successfully.");
  logger.Add(`Expected reduction: ${Math.round(currentBitrateKbps)}kbps → ${targetBitrate}kbps (${Math.round((1 - targetBitrate/currentBitrateKbps) * 100)}% reduction)`);
  
  response.infoLog = logger.GetLogData();
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;