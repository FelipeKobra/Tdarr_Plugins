/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC_MKV',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - H264/HEVC to NVENC Focused on MKV Containers (Pure CUDA Opt)',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    `This plugin will transcode H264 or reconvert HEVC files using NVENC with bframes, 10bit, and (optional) HDR. 
    Optimized for pure CUDA pipeline performance (Zero-Copy VRAM) with crop-safe passthrough handling. Requires a Turing NVIDIA GPU or newer.`,
  Version: '1.6',
  Tags: 'pre-processing,ffmpeg,nvenc h265, hdr, cuda',
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
      tooltip: 'Specify the target reduction for H264 bitrates if the current bitrate is less than resolution targets.',
    },
    {
      name: 'bframes',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Enables or disables bframes from being used.',
    },
    {
      name: 'reconvert_hevc',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Will reconvert hevc files that are above the hevc_resolution_filter_bitrate',
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
    },
    {
      name: 'hevc_720p_filter_bitrate',
      type: 'number',
      defaultValue: 3000,
      inputUI: { type: 'text' },
    },
    {
      name: 'hevc_1080p_filter_bitrate',
      type: 'number',
      defaultValue: 4000,
      inputUI: { type: 'text' },
    },
    {
      name: 'hevc_filter_bitrate_4KUHD',
      type: 'number',
      defaultValue: 8000,
      inputUI: { type: 'text' },
    },
    {
      name: 'tagName',
      type: 'string',
      defaultValue: 'COPYRIGHT',
      inputUI: { type: 'text' },
    },
    {
      name: 'tagValues',
      type: 'string',
      defaultValue: 'processed',
      inputUI: { type: 'text' },
    },
    {
      name: 'exactMatch',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
    },
    {
      name: 'continueIfTagFound',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
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
  AddInputSetting(configuration) { if (configuration && configuration.trim() !== '') this.inputSettings.push(configuration); }
  AddOutputSetting(configuration) { this.shouldProcess = true; this.outputSettings.push(configuration); }
  GetOutputSettings() { return this.outputSettings.join(' '); }
  GetInputSettings() { return this.inputSettings.join(' '); }
}

function checkAbort(inputs, file, logger) {
  if (file.fileMedium !== 'video') { logger.AddError('File is not a video.'); return true; }
  return false;
}

function calculateBitrate(file) {
  let bitrateProbe = file.ffProbeData.streams[0].bit_rate;
  return isNaN(bitrateProbe) ? file.bit_rate : bitrateProbe;
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
  const isHDR = (stream.color_space && ['bt2020', 'bt2020nc'].includes(stream.color_space)) || 
                (stream.color_transfer && stream.color_transfer === 'smpte2084');

  logger.Add(`Checking HDR Metadata for video stream ${id}`);
  if (isHDR) {
    logger.Add(`HDR Color Space/Transfer detected no stream ${id}`);
    if (!inputs.reconvert_hdr) {
      logger.AddError(`HDR detectado. Pulando codificação devido a reconvert_hdr=false.`);
      return false;
    }
    logger.AddSuccess(`Mantendo metadados HDR originais.`);
    configuration.AddOutputSetting(' -strict unofficial -color_primaries bt2020 -colorspace bt2020nc -color_trc smpte2084 ');
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
    h263: '-c:v h263_cuvid',
    h264: '-c:v h264_cuvid',
    mjpeg: '-c:v mjpeg_cuvid',
    mpeg1: '-c:v mpeg1_cuvid',
    mpeg2: '-c:v mpeg2_cuvid',
    vc1: '-c:v vc1_cuvid',
    vp8: '-c:v vp8_cuvid',
    vp9: '-c:v vp9_cuvid',
    hevc: '-c:v hevc_cuvid',
  };

  function videoProcess(stream, id) {
    if (stream.codec_name === 'mjpeg') { configuration.AddOutputSetting(`-map -v:${id}`); return; }
    if (!checkHDRMetadata(stream, id, inputs, logger, configuration)) return;

    const filterBitrate480 = (inputs.hevc_480p_576p_filter_bitrate * 1000);
    const filterBitrate720 = (inputs.hevc_720p_filter_bitrate * 1000);
    const filterBitrate1080 = (inputs.hevc_1080p_filter_bitrate * 1000);
    const filterBitrate4k = (inputs.hevc_filter_bitrate_4KUHD * 1000);
    const fileResolution = file.video_resolution;

    if (inputs.reconvert_hevc === false && (stream.codec_name === 'hevc' || stream.codec_name === 'vp9')) {
      logger.AddSuccess(`Video stream ${id} is hevc, and hevc reconvert is off`);
      return;
    }

    function reconvertcheck(filterbitrate, res, res2) {
      if ((filterbitrate > 0) && ((fileResolution === res) || (fileResolution === res2))) {
        if ((stream.codec_name === 'hevc' || stream.codec_name === 'vp9') && (file.bit_rate < filterbitrate)) {
          logger.AddSuccess(`Stream ${id} abaixo do critério de processamento.`);
          return true;
        }
      }
      return false;
    }

    if (reconvertcheck(filterBitrate480, '480p', '576p') || reconvertcheck(filterBitrate720, '720p') || 
        reconvertcheck(filterBitrate1080, '1080p') || reconvertcheck(filterBitrate4k, '4KUHD')) {
      return;
    }

    if (stream.codec_name === 'png') {
      configuration.AddOutputSetting(`-map -0:v:${id}`);
    } else {
      const bitrateProbe = (calculateBitrate(file) / 1000);
      let bitrateTarget = 0;
      const tier = tiered[file.video_resolution] || tiered.Other;
      
      const bitrateCheck = parseInt(tier.bitrate);
      if (bitrateProbe !== null && bitrateProbe < bitrateCheck) {
        bitrateTarget = parseInt(bitrateProbe * inputs.target_pct_reduction);
      } else {
        bitrateTarget = parseInt(tier.bitrate);
      }
      const bitrateMax = bitrateTarget + tier.max_increase;
      const { cq } = tier;

      // AJUSTE 1: Adicionado "passthrough=0" ao scale_cuda para garantir proteção contra distorções em arquivos com crop
      // Mantido o "-multipass fullres" conforme solicitado
      configuration.AddOutputSetting(`-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -vf "scale_cuda=format=p010le:passthrough=0" -gpu 0 -surfaces 64 -qmin 0 -cq:v ${cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset slow -multipass fullres -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 -threads 1 -metadata:s:v:0 COPYRIGHT=processed`);
      
      let decoderSetting = inputDecoderSettings[file.video_codec_name];

      if (file.video_codec_name === 'h264') {
        const bitDepth = stream.bits_per_raw_sample ? parseInt(stream.bits_per_raw_sample, 10) : 8;
        const is10bit = bitDepth === 10 || (stream.pix_fmt && stream.pix_fmt.includes('10'));

        if (is10bit) {
          logger.Add(`[AVISO] H264 de 10 bits detectado. Desativando cuvid decoder temporariamente para processar na CPU.`);
          decoderSetting = ''; 
        }
      }

      if (decoderSetting !== undefined && decoderSetting.trim() !== '') {
        configuration.AddInputSetting(decoderSetting);
      }

      logger.Add(`Transcoding stream ${id} to HEVC using NVidia NVENC`);
    }
  }

  loopOverStreamsOfType(file, 'video', videoProcess);
  if (!configuration.shouldProcess) logger.AddSuccess('No video processing necessary');
  return configuration;
}

function buildAudioConfiguration() { return new Configurator(['-c:a copy']); }
function buildSubtitleConfiguration() { return new Configurator(['-c:s copy']); }

function checkTags(file, inputs) {
  const { strHasValue } = require('../methods/utils');
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = { processFile: false, infoLog: '' };
  
  if (inputs.tagName.trim() === '' || inputs.tagValues.trim() === '') return { processFile: true, infoLog: '' };
  
  const tagName = inputs.tagName.trim();
  const tagValues = inputs.tagValues.trim().split(',');
  let streamContainsTag = false;

  try {
    for (let i = 0; i < file.ffProbeData.streams.length; i++) {
      if (file.ffProbeData.streams[i]?.tags && strHasValue(tagValues, file.ffProbeData.streams[i].tags[tagName], inputs.exactMatch)) {
        streamContainsTag = true;
        break;
      }
    }
    if (inputs.continueIfTagFound === false && streamContainsTag === true) {
      response.processFile = false;
      response.infoLog += `Tag encontrada. Ignorando arquivo para evitar loops.\n`;
    } else {
      response.processFile = true;
    }
  } catch (err) {
    response.processFile = false;
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
    response.processFile = false;
    response.infoLog += tagCheck.infoLog;
    return response;
  }
  
  if (checkAbort(inputs, file, logger)) {
    response.processFile = false;
    response.infoLog += logger.GetLogData();
    return response;
  }

  const videoSettings = buildVideoConfiguration(inputs, file, logger);
  const audioSettings = buildAudioConfiguration();
  const subtitleSettings = buildSubtitleConfiguration();

  let inputOptions = '-hwaccel cuda -hwaccel_output_format cuda -analyzeduration 2147483647 -probesize 2147483647';
  const videoInputSettings = videoSettings.GetInputSettings();
  if (videoInputSettings && videoInputSettings.trim() !== '') {
    inputOptions += ` ${videoInputSettings}`;
  }

  let outputOptions = videoSettings.GetOutputSettings();
  outputOptions += ` ${audioSettings.GetOutputSettings()}`;
  outputOptions += ` ${subtitleSettings.GetOutputSettings()}`;
  outputOptions += ' -max_muxing_queue_size 9999';

  if (inputs.bframes === true) {
    outputOptions += ' -bf 2 -b_ref_mode middle';
  }
  
  response.preset = `${inputOptions.trim()},${outputOptions.trim()}`;
  response.processFile = videoSettings.shouldProcess;
  response.infoLog += logger.GetLogData();
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;