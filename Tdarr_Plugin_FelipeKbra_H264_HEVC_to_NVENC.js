/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: "Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC",
  Stage: "Pre-processing",
  Name: "FelipeKbra - H264/HEVC to NVENC",
  Type: "Video",
  Operation: "Transcode",
  Description: `This plugin converts videos to HEVC using NVENC.
    Logs are organized in phases for better debugging.`,
  Version: "4.1",
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
      tooltip: "Reduction for H264 bitrates if probe is lower than targets.",
    },
    {
      name: "nvenc_preset",
      type: "string",
      defaultValue: "p4",
      inputUI: {
        type: "dropdown",
        options: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "slow", "medium", "fast"],
      },
      tooltip: "NVENC preset. p4 or p5 is recommended for FFmpeg 7+.",
    },
    {
      name: "bframes",
      type: "boolean",
      defaultValue: false,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Enables bframes. Requires NVIDIA Turing+ architecture.",
    },
    {
      name: "reconvert_hevc",
      type: "boolean",
      defaultValue: true,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Reconvert HEVC files missing hvc1 or above bitrate limit.",
    },
    {
      name: "keep_hdr",
      type: "boolean",
      defaultValue: false,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Enable or disable reconverting HDR files.",
    },
    {
      name: "tagName",
      type: "string",
      defaultValue: "comment",
      inputUI: { type: "text" },
    },
    {
      name: "tagValues",
      type: "string",
      defaultValue: "processed",
      inputUI: { type: "text" },
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
  logger.Add(`File identified as video: ${file.file_name}`);
  logger.Add(`Current container: ${file.container}`);

  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  if (!videoStream) {
    logger.AddError("No valid video stream found in ffProbe data.");
    response.infoLog = logger.GetLogData();
    return response;
  }

  // --- STAGE 2: METADATA & CODEC ANALYSIS ---
  logger.Phase(2, "CODEC & METADATA ANALYSIS");
  const currentCodec = videoStream.codec_name;
  const currentTag = videoStream.codec_tag_string || "none";
  const hasProcessedTag = file.ffProbeData.format?.tags?.[inputs.tagName] === inputs.tagValues;
  
  logger.Add(`Video Codec: ${currentCodec} | Tag: ${currentTag}`);
  if (hasProcessedTag) logger.Add(`Found processing tag: ${inputs.tagName}=${inputs.tagValues}`);

  const hdrTransferFunctions = ['smpte2084', 'arib-std-b67'];
  let isHDR = videoStream.color_trc && hdrTransferFunctions.includes(videoStream.color_trc);
  if (!isHDR && videoStream.side_data_list) {
    isHDR = videoStream.side_data_list.some(data => data.side_data_type === 'DOVI configuration record');
  }
  logger.Add(`HDR Detected: ${isHDR ? "YES" : "NO"}`);

  // Decision logic for HEVC
  if (currentCodec === 'hevc' && currentTag === 'hvc1') {
    if (hasProcessedTag && !inputs.reconvert_hevc) {
        logger.AddSuccess("File is HEVC/hvc1 and already tagged. Skipping.");
        response.infoLog = logger.GetLogData();
        return response;
    }
    if (!inputs.reconvert_hevc) {
        logger.AddSuccess("File is HEVC/hvc1. Reconvert is OFF. Skipping.");
        response.infoLog = logger.GetLogData();
        return response;
    }
  }

  // --- STAGE 3: BITRATE & SIZE FILTERING ---
  logger.Phase(3, "BITRATE & SIZE CALCULATIONS");
  const fileSizeMB = file.file_size;
  if (inputs.min_file_size_mb > 0 && fileSizeMB < inputs.min_file_size_mb) {
    logger.AddWarning(`File size (${Math.round(fileSizeMB)}MB) is below minimum (${inputs.min_file_size_mb}MB).`);
    // Se já for HEVC/hvc1 e for pequeno, não faz nada.
    if (currentCodec === 'hevc' && currentTag === 'hvc1') {
        logger.AddSuccess("HEVC file is small but healthy. Skipping.");
        response.infoLog = logger.GetLogData();
        return response;
    }
  }

  const currentBitrate = calculateBitrate(file) / 1000;
  const tiered = {
    "480p": inputs.target_bitrate_480p576p,
    "576p": inputs.target_bitrate_480p576p,
    "720p": inputs.target_bitrate_720p,
    "1080p": inputs.target_bitrate_1080p,
    "4KUHD": inputs.target_bitrate_4KUHD,
  };
  
  const targetBitrateBase = tiered[file.video_resolution] || inputs.target_bitrate_1080p;
  let targetBitrate = (currentBitrate < targetBitrateBase) ? Math.round(currentBitrate * inputs.target_pct_reduction) : targetBitrateBase;

  logger.Add(`Resolution: ${file.video_resolution}`);
  logger.Add(`Current Bitrate: ${Math.round(currentBitrate)}kbps`);
  logger.Add(`Calculated Target: ${targetBitrate}kbps`);

  // --- STAGE 4: HARDWARE ACCELERATION SETUP ---
  logger.Phase(4, "HARDWARE ACCELERATION");
  const { getNvdecHwaccelPreset } = require('../methods/nvdecPreset');
  
  // Using softwareFrames: true to bridge NVDEC and NVENC safely in FFmpeg 7+
  const nvencDecodeOptions = { softwareFrames: true }; 
  const hwaccel = getNvdecHwaccelPreset(file, nvencDecodeOptions);
  
  if (hwaccel) {
    logger.AddSuccess(`Hardware acceleration enabled: ${hwaccel}`);
  } else {
    logger.AddWarning("Hardware acceleration not returned by helper. Falling back to CPU decode.");
  }

  // --- STAGE 5: FINAL COMMAND ASSEMBLY ---
  logger.Phase(5, "ENCODER PARAMETERS ASSEMBLY");
  let videoOptions = `-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le -preset ${inputs.nvenc_preset} `;
  videoOptions += `-cq:v 19 -b:v ${targetBitrate}k -maxrate:v ${Math.round(targetBitrate * 1.5)}k -bufsize ${targetBitrate * 2}k `;
  videoOptions += `-spatial_aq:v 1 -rc-lookahead:v 32 -metadata ${inputs.tagName}=${inputs.tagValues} `;

  if (isHDR && !inputs.keep_hdr) {
    logger.Add("Adding HDR to SDR (Tonemapping) CUDA filters.");
    videoOptions += '-vf "tonemap_cuda=t=bt709:m=bt709:p=bt709:format=p010le" -colorspace bt709 -color_primaries bt709 -color_trc bt709 ';
  } else if (isHDR) {
    logger.Add("Maintaining HDR metadata in HEVC stream.");
    videoOptions += '-colorspace bt2020nc -color_primaries bt2020 -color_trc smpte2084 ';
  }

  if (inputs.bframes) {
    logger.Add("B-Frames enabled (Setting -bf 5).");
    videoOptions += "-bf 5 ";
  }

  response.processFile = true;
  response.preset = `${hwaccel}, -fflags +genpts -map 0 ${videoOptions} -c:a copy -c:s copy -max_muxing_queue_size 9999`;

  logger.AddSuccess("Final FFmpeg command built successfully.");
  response.infoLog = logger.GetLogData();
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;