/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: "Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC",
  Stage: "Pre-processing",
  Name: "FelipeKbra - H264/HEVC to NVENC (hvc1 + Size Filter)",
  Type: "Video",
  Operation: "Transcode",
  Description: `This plugin converts videos to HEVC using NVENC, ensuring:
    1. hvc1 Tag (Apple/Plex Compatibility).
    2. 10-bit and Optional HDR support.
    3. Minimum file size skip logic.`,
  Version: "2.4",
  Tags: "pre-processing,ffmpeg,nvenc h265, hdr, hvc1, size filter",
  Inputs: [
    {
      name: "min_file_size_mb",
      type: "number",
      defaultValue: 7000,
      inputUI: { type: "text" },
      tooltip:
        "Skip processing if file size (MB) is below this value (only for files that are already technically healthy but missing the tag).",
    },
    {
      name: "target_bitrate_480p576p",
      type: "number",
      defaultValue: 1000,
      inputUI: { type: "text" },
      tooltip:
        "Specify the target bitrate in kilobits for 480p and 576p files.",
    },
    {
      name: "target_bitrate_720p",
      type: "number",
      defaultValue: 2000,
      inputUI: { type: "text" },
      tooltip: "Specify the target bitrate in kilobits for 720p files.",
    },
    {
      name: "target_bitrate_1080p",
      type: "number",
      defaultValue: 4000,
      inputUI: { type: "text" },
      tooltip: "Specify the target bitrate in kilobits for 1080p files.",
    },
    {
      name: "target_bitrate_4KUHD",
      type: "number",
      defaultValue: 8000,
      inputUI: { type: "text" },
      tooltip: "Specify the target bitrate in kilobits for 4KUHD files.",
    },
    {
      name: "target_pct_reduction",
      type: "number",
      defaultValue: 0.5,
      inputUI: { type: "text" },
      tooltip:
        "Specify the target reduction for H264 bitrates if probe is lower than targets.",
    },
    {
      name: "nvenc_preset",
      type: "string",
      defaultValue: "slow",
      inputUI: {
        type: "dropdown",
        options: [
          "p1",
          "p2",
          "p3",
          "p4",
          "p5",
          "p6",
          "p7",
          "slow",
          "medium",
          "fast",
        ],
      },
      tooltip:
        "Set the NVENC encoder preset. Slow results in better quality/compression.",
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
      tooltip:
        "Will reconvert HEVC files above bitrate filter or missing hvc1 tag.",
    },
    {
      name: "keep_hdr",
      type: "boolean",
      defaultValue: false,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Enable or disable reconverting HDR files.",
    },
    {
      name: "hevc_480p_576p_filter_bitrate",
      type: "number",
      defaultValue: 2000,
      inputUI: { type: "text" },
      tooltip:
        "Skip HEVC files of this resolution if bitrate is below this value.",
    },
    {
      name: "hevc_720p_filter_bitrate",
      type: "number",
      defaultValue: 3000,
      inputUI: { type: "text" },
      tooltip:
        "Skip HEVC files of this resolution if bitrate is below this value.",
    },
    {
      name: "hevc_1080p_filter_bitrate",
      type: "number",
      defaultValue: 4000,
      inputUI: { type: "text" },
      tooltip:
        "Skip HEVC files of this resolution if bitrate is below this value.",
    },
    {
      name: "hevc_filter_bitrate_4KUHD",
      type: "number",
      defaultValue: 8000,
      inputUI: { type: "text" },
      tooltip:
        "Skip HEVC files of this resolution if bitrate is below this value.",
    },
    {
      name: "tagName",
      type: "string",
      defaultValue: "comment",
      inputUI: { type: "text" },
      tooltip: "The metadata key to check/write (default: comment).",
    },
    {
      name: "tagValues",
      type: "string",
      defaultValue: "processed",
      inputUI: { type: "text" },
      tooltip: "The metadata value to check/write (default: processed).",
    },
    {
      name: "exactMatch",
      type: "boolean",
      defaultValue: true,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "Needs to exact match the tag name.",
    },
    {
      name: "continueIfTagFound",
      type: "boolean",
      defaultValue: false,
      inputUI: { type: "dropdown", options: ["false", "true"] },
      tooltip: "This might create a loop, do not use it.",
    },
  ],
});

class Log {
  constructor() {
    this.entries = [];
  }
  Add(entry) {
    this.entries.push(entry);
  }
  AddSuccess(entry) {
    this.entries.push(`☑ ${entry}`);
  }
  AddError(entry) {
    this.entries.push(`☒ ${entry}`);
  }
  GetLogData() {
    return this.entries.join("\n");
  }
}

class Configurator {
  constructor(defaultOutputSettings = null) {
    this.shouldProcess = false;
    this.outputSettings = defaultOutputSettings || [];
    this.inputSettings = [];
  }
  AddInputSetting(configuration) {
    if (configuration?.trim()) this.inputSettings.push(configuration);
  }
  AddOutputSetting(configuration) {
    this.shouldProcess = true;
    this.outputSettings.push(configuration);
  }
  GetOutputSettings() {
    return this.outputSettings.join(" ");
  }
  GetInputSettings() {
    return this.inputSettings.join(" ");
  }
}

function checkAbort(inputs, file, logger) {
  if (file.fileMedium !== "video") {
    logger.AddError("File is not a video. Skipping.");
    return true;
  }
  return false;
}

function calculateBitrate(file) {
  let bitrateProbe = file.ffProbeData.streams[0].bit_rate;
  if (isNaN(bitrateProbe)) bitrateProbe = file.bit_rate;
  return bitrateProbe;
}

function loopOverStreamsOfType(file, type, method) {
  let id = 0;
  for (let i = 0; i < file.ffProbeData.streams.length; i++) {
    if (file.ffProbeData.streams[i].codec_type.toLowerCase() === type) {
      method(file.ffProbeData.streams[i], id);
      id++;
    }
  }
}

function buildVideoConfiguration(inputs, file, logger) {
  const configuration = new Configurator(["-map 0"]);
  const tiered = {
    "480p": {
      bitrate: inputs.target_bitrate_480p576p,
      max_increase: 100,
      cq: 22,
    },
    "576p": {
      bitrate: inputs.target_bitrate_480p576p,
      max_increase: 100,
      cq: 22,
    },
    "720p": { bitrate: inputs.target_bitrate_720p, max_increase: 200, cq: 23 },
    "1080p": {
      bitrate: inputs.target_bitrate_1080p,
      max_increase: 400,
      cq: 24,
    },
    "4KUHD": {
      bitrate: inputs.target_bitrate_4KUHD,
      max_increase: 400,
      cq: 26,
    },
    Other: { bitrate: inputs.target_bitrate_1080p, max_increase: 400, cq: 24 },
  };

  const inputDecoderSettings = {
	h264: "-c:v h264_cuvid",
    hevc: "-c:v hevc_cuvid",
    h263: "-c:v h263_cuvid",
    mjpeg: "-c:v mjpeg_cuvid",
    mpeg1: "-c:v mpeg1_cuvid",
    mpeg2: "-c:v mpeg2_cuvid",
    vc1: "-c:v vc1_cuvid",
    vp8: "-c:v vp8_cuvid",
    vp9: "-c:v vp9_cuvid",
  };

function videoProcess(stream, id) {
    logger.Add(`DEBUG: Checking Stream ${id} | Codec: ${stream.codec_name} | Tag: ${stream.codec_tag_string} | TRC: ${stream.color_trc} | Space: ${stream.color_space}`);

    if (stream.codec_name === 'mjpeg') {
      configuration.AddOutputSetting(`-map -v:${id}`);
      logger.Add(`Mapping out MJPEG stream (poster art) at stream index ${id}.`);
      return;
    }

    // DETECÇÃO CORRETA DE HDR
    const hdrTransferFunctions = ['smpte2084', 'arib-std-b67'];
    let isHDR = stream.color_trc && hdrTransferFunctions.includes(stream.color_trc);
    
    if (!isHDR && stream.side_data_list) {
      isHDR = stream.side_data_list.some(data => 
        data.side_data_type === 'DOVI configuration record'
      );
    }
    
    const videoTag = stream.codec_tag_string || '';
    
    // Skip Logic
    if (stream.codec_name === 'hevc' && videoTag === 'hvc1' && (!isHDR || (isHDR && inputs.keep_hdr))) {
      logger.AddSuccess(`File is already healthy HEVC (hvc1, ${isHDR ? 'HDR' : 'SDR'}).`);
      return;
    }

    const filters = {
      '480p': inputs.hevc_480p_576p_filter_bitrate * 1000,
      '576p': inputs.hevc_480p_576p_filter_bitrate * 1000,
      '720p': inputs.hevc_720p_filter_bitrate * 1000,
      '1080p': inputs.hevc_1080p_filter_bitrate * 1000,
      '4KUHD': inputs.hevc_filter_bitrate_4KUHD * 1000
    };
    
    const fileResolution = file.video_resolution;
    const filterBitrate = filters[fileResolution] || 0;

    if (inputs.reconvert_hevc === false && (stream.codec_name === 'hevc' || stream.codec_name === 'vp9')) {
        logger.Add('Reconvert HEVC is false. Skipping HEVC/VP9 file.');
        return;
    }

    if (filterBitrate > 0 && (stream.codec_name === 'hevc' || stream.codec_name === 'vp9')) {
        if (file.bit_rate < filterBitrate && videoTag === 'hvc1' && (!isHDR || (isHDR && inputs.keep_hdr))) {
            logger.AddSuccess(`HEVC Bitrate (${file.bit_rate}) is below filter (${filterBitrate}). Skipping.`);
            return;
        }
    }

    if (stream.codec_name === 'png') {
      configuration.AddOutputSetting(`-map -0:v:${id}`);
      logger.Add(`Mapping out PNG stream at index ${id}.`);
      return;
    }

    // Construir encoding
    const bitrateProbe = (calculateBitrate(file) / 1000);
    const tier = tiered[file.video_resolution] || tiered.Other;
    let bitrateTarget = (bitrateProbe < parseInt(tier.bitrate)) ? parseInt(bitrateProbe * inputs.target_pct_reduction) : parseInt(tier.bitrate);
    const bitrateMax = bitrateTarget + tier.max_increase;
    const preset = inputs.nvenc_preset || 'slow';
    const dynamicMeta = `-metadata ${inputs.tagName}=${inputs.tagValues}`;

    let videoOptions = '';
    
    if (isHDR && !inputs.keep_hdr) {
      // HDR → SDR (Tone Mapping)
      logger.Add(`Transcoding stream ${id}: HDR → SDR (Tone Mapping + Metadata Stripping)`);
      
      // PASSO 1: Tone mapping no filtro
      videoOptions = '-vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,zscale=t=bt709:m=bt709:r=limited,format=yuv420p10le" ';
      
      // PASSO 2: Encoder com metadados SDR
      videoOptions += '-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le ';
      
      // PASSO 3: Definir metadados SDR explicitamente
      videoOptions += '-colorspace bt709 -color_primaries bt709 -color_trc bt709 ';
      
      // PASSO 4: CRÍTICO - Remover side_data de HDR (mastering display + content light level)
      // Tipo 137 = Mastering Display Metadata
      // Tipo 144 = Content Light Level
      videoOptions += '-bsf:v "filter_units=remove_types=39|40" ';
      
      // PASSO 5: Parâmetros de encoding
      videoOptions += `-qmin 0 -cq:v ${tier.cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset ${preset} -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 ${dynamicMeta}`;
      
    } else if (isHDR && inputs.keep_hdr) {
      // Manter HDR
      logger.Add(`Transcoding stream ${id}: Keeping HDR`);
      
      videoOptions = '-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le ';
      videoOptions += '-colorspace bt2020nc -color_primaries bt2020 -color_trc smpte2084 ';
      videoOptions += `-qmin 0 -cq:v ${tier.cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset ${preset} -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 ${dynamicMeta}`;
      
    } else {
      // SDR normal
      logger.Add(`Transcoding stream ${id}: SDR`);
      
      videoOptions = '-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le ';
      videoOptions += '-colorspace bt709 -color_primaries bt709 -color_trc bt709 ';
      videoOptions += `-qmin 0 -cq:v ${tier.cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset ${preset} -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 ${dynamicMeta}`;
    }
    
    configuration.AddOutputSetting(videoOptions);
    
    const decoderSetting = inputDecoderSettings[file.video_codec_name]; 
    if (decoderSetting?.trim()) configuration.AddInputSetting(decoderSetting);
  }

  loopOverStreamsOfType(file, "video", videoProcess);
  return configuration;
}

function buildAudioConfiguration(inputs, file, logger) {
  return new Configurator(["-c:a copy"]);
}
function buildSubtitleConfiguration(inputs, file, logger) {
  return new Configurator(["-c:s copy"]);
}

function checkTags(file, inputs) {
  const { strHasValue } = require("../methods/utils");
  const lib = require("../methods/lib")();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = { processFile: false, infoLog: "" };
  const tagName = inputs.tagName.trim();
  const tagValues = inputs.tagValues.trim().split(",");
  let hasTag = false;

  if (
    file.ffProbeData.format?.tags &&
    strHasValue(
      tagValues,
      file.ffProbeData.format.tags[tagName],
      inputs.exactMatch,
    )
  )
    hasTag = true;
  if (!hasTag) {
    for (let s of file.ffProbeData.streams) {
      if (
        s.tags &&
        strHasValue(tagValues, s.tags[tagName], inputs.exactMatch)
      ) {
        hasTag = true;
        break;
      }
    }
  }

  if (hasTag) {
    response.infoLog += `Metadata tag [${tagName}] with value [${tagValues}] was found.\n`;
    response.processFile = inputs.continueIfTagFound;
  } else {
    response.infoLog += `Metadata tag [${tagName}] not found. Proceeding with transcode.\n`;
    response.processFile = true;
  }
  return response;
}

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require("../methods/lib")();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    container: `.${file.container}`,
    FFmpegMode: true,
    handBrakeMode: false,
    infoLog: "",
    processFile: false,
    preset: "",
    reQueueAfter: true,
  };
  const logger = new Log();

  if (checkAbort(inputs, file, logger)) {
    response.infoLog += logger.GetLogData();
    return response;
  }

  const videoSettings = buildVideoConfiguration(inputs, file, logger);

  if (videoSettings.shouldProcess) {
    // MANDATORY TRANSCODE (H264, Wrong Tag, Bitrate high, HDR issue)
    // We ignore file size here to ensure health.
    response.processFile = true;
    logger.Add(
      "File requires technical correction (Codec/Tag/Bitrate/HDR). Proceeding regardless of size.",
    );
  } else {
    // TECHNICALLY HEALTHY (HEVC + hvc1)
    // Check if the metadata tag exists.
    const tagCheck = checkTags(file, inputs);

    if (tagCheck.processFile) {
      // Tag is missing. Now check the SIZE filter.
      const fileSizeMB = file.file_size; // Tdarr file_size is in MB
      const minSize = inputs.min_file_size_mb || 0;

      if (minSize > 0 && fileSizeMB < minSize) {
        response.processFile = false;
        logger.Add(
          `File is technically healthy but missing tag. Size (${fileSizeMB.toFixed(2)}MB) is below minimum (${minSize}MB). Skipping.`,
        );
      } else {
        response.processFile = true;
        response.infoLog += tagCheck.infoLog;
        logger.Add(
          "File is healthy but missing tag. Size is above minimum. Re-tagging.",
        );
      }
    } else {
      // Tag found, skip.
      response.processFile = tagCheck.processFile;
      response.infoLog += tagCheck.infoLog;
    }
  }

  if (response.processFile) {
    const audioSettings = buildAudioConfiguration(inputs, file, logger);
    const subtitleSettings = buildSubtitleConfiguration(inputs, file, logger);

    let inputOptions =
      "-hwaccel cuda -analyzeduration 2147483647 -probesize 2147483647";
    if (videoSettings.GetInputSettings().trim())
      inputOptions += ` ${videoSettings.GetInputSettings()}`;

    let outputOptions = `${videoSettings.GetOutputSettings()} ${audioSettings.GetOutputSettings()} ${subtitleSettings.GetOutputSettings()} -max_muxing_queue_size 9999`;

    if (inputs.bframes) {
      outputOptions += " -bf 2 -b_ref_mode middle";
      logger.Add("B-Frames enabled.");
    }

    response.preset = `${inputOptions.trim()},${outputOptions.trim()}`;
  }

  response.infoLog += logger.GetLogData();
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
