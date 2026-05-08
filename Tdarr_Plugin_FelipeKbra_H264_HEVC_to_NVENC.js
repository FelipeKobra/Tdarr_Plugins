/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - H264/HEVC to NVENC (hvc1 + CFR)',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    `This plugin converts videos to HEVC using NVENC, ensuring:
    1. hvc1 Tag (Apple/Plex Compatibility).
    2. CFR 23.976fps (Fixes Variable Frame Rate/Audio Sync issues).
    3. 10-bit and Optional HDR support.`,
  Version: '2.0',
  Tags: 'pre-processing,ffmpeg,nvenc h265, hdr, cfr, hvc1',
  Inputs: [
    {
      name: 'target_bitrate_480p576p',
      type: 'number',
      defaultValue: 1000,
      inputUI: { type: 'text' },
      tooltip: 'Specify the target bitrate in kilobits for 480p and 576p files.',
    },
    {
      name: 'target_bitrate_720p',
      type: 'number',
      defaultValue: 2000,
      inputUI: { type: 'text' },
      tooltip: 'Specify the target bitrate in kilobits for 720p files.',
    },
    {
      name: 'target_bitrate_1080p',
      type: 'number',
      defaultValue: 4000,
      inputUI: { type: 'text' },
      tooltip: 'Specify the target bitrate in kilobits for 1080p files.',
    },
    {
      name: 'target_bitrate_4KUHD',
      type: 'number',
      defaultValue: 8000,
      inputUI: { type: 'text' },
      tooltip: 'Specify the target bitrate in kilobits for 4KUHD files.',
    },
    {
      name: 'target_pct_reduction',
      type: 'number',
      defaultValue: 0.5,
      inputUI: { type: 'text' },
      tooltip: 'Specify the target reduction for H264 bitrates if probe is lower than targets.',
    },
    {
      name: 'nvenc_preset',
      type: 'string',
      defaultValue: 'slow',
      inputUI: { 
        type: 'dropdown', 
        options: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'slow', 'medium', 'fast'] 
      },
      tooltip: 'Set the NVENC encoder preset. Slow results in better quality/compression.',
    },
    {
      name: 'bframes',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Enables bframes. Requires NVIDIA Turing+ architecture.',
    },
    {
      name: 'reconvert_hevc',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Will reconvert HEVC files above bitrate filter or missing hvc1 tag.',
    },
    {
      name: 'reconvert_hdr',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Enable or disable reconverting HDR files.',
    },
    {
      name: 'hevc_480p_576p_filter_bitrate',
      type: 'number',
      defaultValue: 2000,
      inputUI: { type: 'text' },
      tooltip: 'Skip HEVC files of this resolution if bitrate is below this value.',
    },
    {
      name: 'hevc_720p_filter_bitrate',
      type: 'number',
      defaultValue: 3000,
      inputUI: { type: 'text' },
      tooltip: 'Skip HEVC files of this resolution if bitrate is below this value.',
    },
    {
      name: 'hevc_1080p_filter_bitrate',
      type: 'number',
      defaultValue: 4000,
      inputUI: { type: 'text' },
      tooltip: 'Skip HEVC files of this resolution if bitrate is below this value.',
    },
    {
      name: 'hevc_filter_bitrate_4KUHD',
      type: 'number',
      defaultValue: 8000,
      inputUI: { type: 'text' },
      tooltip: 'Skip HEVC files of this resolution if bitrate is below this value.',
    },
    {
      name: 'tagName',
      type: 'string',
      defaultValue: 'comment',
      inputUI: { type: 'text' },
      tooltip: 'The metadata key to check/write (default: comment).',
    },
    {
      name: 'tagValues',
      type: 'string',
      defaultValue: 'processed',
      inputUI: { type: 'text' },
      tooltip: 'The metadata value to check/write (default: processed).',
    },
    {
      name: 'exactMatch',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
	   tooltip: 'Needs to exact match de tag name.',
    },
    {
      name: 'continueIfTagFound',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
	   tooltip: 'This might create a loop, dont use it.',
    },
  ],
});

class Log {
  constructor() { this.entries = []; }
  Add(entry) { this.entries.push(entry); }
  AddSuccess(entry) { this.entries.push(`☑ ${entry}`); }
  AddError(entry) { this.entries.push(`☒ ${entry}`); }
  GetLogData() { return this.entries.join('\n'); }
}

class Configurator {
  constructor(defaultOutputSettings = null) {
    this.shouldProcess = false;
    this.outputSettings = defaultOutputSettings || [];
    this.inputSettings = [];
  }
  AddInputSetting(configuration) { if (configuration?.trim()) this.inputSettings.push(configuration); }
  AddOutputSetting(configuration) { this.shouldProcess = true; this.outputSettings.push(configuration); }
  GetOutputSettings() { return this.outputSettings.join(' '); }
  GetInputSettings() { return this.inputSettings.join(' '); }
}

function checkAbort(inputs, file, logger) {
  if (file.fileMedium !== 'video') {
    logger.AddError('File is not a video. Skipping.');
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

function checkHDRMetadata(stream, id, inputs, logger, configuration) {
  const hdrColorSpaces = ['smpte2084', 'bt2020', 'bt2020nc'];
  if (stream.color_space && hdrColorSpaces.includes(stream.color_space)) {
    if (!inputs.reconvert_hdr) {
      logger.AddError(`HDR detected on stream ${id} but 'reconvert_hdr' is disabled. Skipping file.`);
      return false;
    }
    logger.Add(`HDR detected on stream ${id}. Applying HDR-specific metadata flags.`);
    if (stream.color_space === 'bt2020nc' || stream.color_space === 'bt2020') {
      configuration.AddOutputSetting(' -strict unofficial -color_primaries bt2020 -colorspace bt2020nc -color_trc smpte2084 ');
    }
    return true;
  }
  return true;
}

function buildVideoConfiguration(inputs, file, logger) {
  const configuration = new Configurator(['-map 0']);
  const tiered = {
    '480p': { bitrate: inputs.target_bitrate_480p576p, max_increase: 100, cq: 22 },
    '576p': { bitrate: inputs.target_bitrate_480p576p, max_increase: 100, cq: 22 },
    '720p': { bitrate: inputs.target_bitrate_720p, max_increase: 200, cq: 23 },
    '1080p': { bitrate: inputs.target_bitrate_1080p, max_increase: 400, cq: 24 },
    '4KUHD': { bitrate: inputs.target_bitrate_4KUHD, max_increase: 400, cq: 26 },
    Other: { bitrate: inputs.target_bitrate_1080p, max_increase: 400, cq: 24 },
  };

  const inputDecoderSettings = {
    h263: '-c:v h263_cuvid', mjpeg: '-c:v mjpeg_cuvid', mpeg1: '-c:v mpeg1_cuvid',
    mpeg2: '-c:v mpeg2_cuvid', vc1: '-c:v vc1_cuvid', vp8: '-c:v vp8_cuvid', vp9: '-c:v vp9_cuvid',
  };

  function videoProcess(stream, id) {
    if (stream.codec_name === 'mjpeg') {
      configuration.AddOutputSetting(`-map -v:${id}`);
      logger.Add(`Mapping out MJPEG stream (poster art) at stream index ${id}.`);
      return;
    }
    if (!checkHDRMetadata(stream, id, inputs, logger, configuration)) return;

    // --- VFR (Variable Frame Rate) DETECTION ---
    const isVFR = stream.avg_frame_rate !== stream.r_frame_rate;
    if (isVFR) { logger.Add(`VFR detected on stream ${id}. Forcing Constant Frame Rate (CFR).`); }

    // --- SKIP LOGIC ---
    const videoTag = stream.codec_tag_string || '';
    const fileSizeMB = file.file_size; 
    
    // Condition to Skip: HEVC AND < 7GB AND Tagged hvc1 AND Not VFR
    if (stream.codec_name === 'hevc' && fileSizeMB < 7000 && videoTag === 'hvc1' && !isVFR) {
      logger.AddSuccess(`File is already healthy HEVC (<7GB, hvc1, CFR). Skipping transcode.`);
      return;
    } else {
        if (stream.codec_name === 'hevc') {
            if (videoTag !== 'hvc1') logger.Add(`HEVC detected but tag is [${videoTag}] (Needs hvc1).`);
            if (isVFR) logger.Add(`Frame rate is variable (VFR) (Needs CFR for sync).`);
            if (fileSizeMB >= 7000) logger.Add(`File size (${fileSizeMB.toFixed(2)}MB) exceeds 7GB limit.`);
        }
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
        if (file.bit_rate < filterBitrate && videoTag === 'hvc1' && !isVFR) {
            logger.AddSuccess(`HEVC Bitrate (${file.bit_rate}) is below filter (${filterBitrate}). Skipping.`);
            return;
        }
    }

    if (stream.codec_name === 'png') {
      configuration.AddOutputSetting(`-map -0:v:${id}`);
      logger.Add(`Mapping out PNG stream at index ${id}.`);
    } else {
      const bitrateProbe = (calculateBitrate(file) / 1000);
      const tier = tiered[file.video_resolution] || tiered.Other;
      let bitrateTarget = (bitrateProbe < parseInt(tier.bitrate)) ? parseInt(bitrateProbe * inputs.target_pct_reduction) : parseInt(tier.bitrate);
      const bitrateMax = bitrateTarget + tier.max_increase;

      // SPEED PRESET
      const preset = inputs.nvenc_preset || 'slow';
      
      // DYNAMIC METADATA COMMENT
      const dynamicMeta = `-metadata ${inputs.tagName}=${inputs.tagValues}`;

      // FINAL OUTPUT FLAGS
      configuration.AddOutputSetting(`-c:v hevc_nvenc -tag:v hvc1 -r 24000/1001 -vsync cfr -profile:v main10 -pix_fmt:v p010le -qmin 0 -cq:v ${tier.cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset ${preset} -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 ${dynamicMeta}`);
      
      const decoderSetting = inputDecoderSettings[file.video_codec_name];
      if (decoderSetting?.trim()) configuration.AddInputSetting(decoderSetting);

      logger.Add(`Transcoding stream ${id} to HEVC (NVENC | Preset: ${preset} | Tag: hvc1 | CFR | FastStart)`);
    }
  }

  loopOverStreamsOfType(file, 'video', videoProcess);
  return configuration;
}

function buildAudioConfiguration(inputs, file, logger) { return new Configurator(['-c:a copy']); }
function buildSubtitleConfiguration(inputs, file, logger) { return new Configurator(['-c:s copy']); }

function checkTags(file, inputs) {
  const { strHasValue } = require('../methods/utils');
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = { processFile: false, infoLog: '' };
  const tagName = inputs.tagName.trim();
  const tagValues = inputs.tagValues.trim().split(',');
  let hasTag = false;

  if (file.ffProbeData.format?.tags && strHasValue(tagValues, file.ffProbeData.format.tags[tagName], inputs.exactMatch)) hasTag = true;
  if (!hasTag) {
    for (let s of file.ffProbeData.streams) {
      if (s.tags && strHasValue(tagValues, s.tags[tagName], inputs.exactMatch)) { hasTag = true; break; }
    }
  }
  
  if (hasTag) {
      response.infoLog += `Metadata tag [${tagName}] with value [${tagValues}] was found.\n`;
      response.processFile = inputs.continueIfTagFound;
  } else {
      response.infoLog += `Metadata tag [${tagName}] not found. Proceeding with analysis.\n`;
      response.processFile = true;
  }
  return response;
}

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    container: `.${file.container}`,
    FFmpegMode: true,
    handBrakeMode: false,
    infoLog: '',
    processFile: false,
    preset: '',
    reQueueAfter: true,
  };
  const logger = new Log();
  
  const tagCheck = checkTags(file, inputs);
  if (!tagCheck.processFile) {
      response.infoLog += tagCheck.infoLog;
      return response;
  }

  if (checkAbort(inputs, file, logger)) {
    response.infoLog += logger.GetLogData();
    return response;
  }

  const videoSettings = buildVideoConfiguration(inputs, file, logger);
  const audioSettings = buildAudioConfiguration(inputs, file, logger);
  const subtitleSettings = buildSubtitleConfiguration(inputs, file, logger);

  let inputOptions = '-hwaccel cuda -hwaccel_output_format cuda -analyzeduration 2147483647 -probesize 2147483647';
  if (videoSettings.GetInputSettings().trim()) inputOptions += ` ${videoSettings.GetInputSettings()}`;

  let outputOptions = `${videoSettings.GetOutputSettings()} ${audioSettings.GetOutputSettings()} ${subtitleSettings.GetOutputSettings()} -max_muxing_queue_size 9999`;
  
  if (inputs.bframes) {
      outputOptions += ' -bf 2 -b_ref_mode middle';
      logger.Add('B-Frames enabled (Turing+ Architecture required).');
  }
  
  response.preset = `${inputOptions.trim()},${outputOptions.trim()}`;
  response.processFile = videoSettings.shouldProcess;
  response.infoLog += logger.GetLogData();
  
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;