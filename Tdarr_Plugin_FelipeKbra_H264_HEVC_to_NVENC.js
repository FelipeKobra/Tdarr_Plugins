/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - H264/HEVC to NVENC',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    `This  plugin will transcode H264 or reconvert HEVC files using NVENC with bframes, 10bit, and (optional) HDR. Requires a Turing NVIDIA GPU or newer.  
    If reconvert HEVC is on and the entire file is over the bitrate filter, the HEVC stream will be re-encoded. Typically results in a 50-75% smaller size with little to no quality loss.
    When setting the re-encode bitrate filter be aware that it is a file total bitrate, so leave overhead for audio.
This plugin implements the filter_by_stream_tag plugin to prevent infinite loops caused by reprocessing files above the filter or target bitrate.
By default, all settings are ideal for most use cases.
Version 1.4: Fixed h264_cuvid error for 10-bit H.264 videos. Now uses software decoder for 10-bit content.`,
  //    Original plugin created by tws101 who was inspired by DOOM and MIGZ
  //    This version edited by /u/purpan
  Version: '1.4',
  Tags: 'pre-processing,ffmpeg,nvenc h265, hdr',
  Inputs: [
    {
      name: 'target_bitrate_480p576p',
      type: 'number',
      defaultValue: 1000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the target bitrate in kilobits for 480p and 576p files.  Example 400 equals 400k',
    },
    {
      name: 'target_bitrate_720p',
      type: 'number',
      defaultValue: 2000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the target bitrate in kilobits for 720p files. Example 400 equals 400k',
    },
    {
      name: 'target_bitrate_1080p',
      type: 'number',
      defaultValue: 4000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the target bitrate in kilobits for 1080p files. Example 400 equals 400k',
    },
    {
      name: 'target_bitrate_4KUHD',
      type: 'number',
      defaultValue: 8000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the target bitrate in kilobits for 4KUHD files. Example 400 equals 400k',
    },
    {
      name: 'target_pct_reduction',
      type: 'number',
      defaultValue: 0.5,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the target reduction for H264 bitrates if the current bitrate is less than resolution targets.',
    },
    {
      name: 'bframes',
      type: 'boolean',
      defaultValue: false,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip: 'Enables or disables bframes from being used. Sacrifices some detail for better compression. Requires NVIDIA Turing card or newer',
    },
{
      name: 'reconvert_hevc',
      type: 'boolean',
      defaultValue: true,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip: 'Will reconvert hevc files that are above the hevc_resolution_filter_bitrate',
    },
{
      name: 'reconvert_hdr',
      type: 'boolean',
      defaultValue: false,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip: 'Enable or disable reconverting HDR files. NOT recommended for HDR10/+/Dolby Vision files as it strips some HDR metadata and leaves just PQ',
    },
  {
      name: 'hevc_480p_576p_filter_bitrate',
      type: 'number',
      defaultValue: 2000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Filter bitrate in kilobits to reconvert_480p_576p_hevc. Example 1200 equals 1200k ',
    },
  {
      name: 'hevc_720p_filter_bitrate',
      type: 'number',
      defaultValue: 3000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Filter bitrate in kilobits to reconvert_720p_hevc. Example 1200 equals 1200k ',
    },
  {
      name: 'hevc_1080p_filter_bitrate',
      type: 'number',
      defaultValue: 4000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Filter bitrate in kilobits to reconvert_1080p_hevc. Example 1200 equals 1200k ',
    },
  {
      name: 'hevc_filter_bitrate_4KUHD',
      type: 'number',
      defaultValue: 8000,
      inputUI: {
        type: 'text',
      },
      tooltip: 'Filter bitrate in kilobits to reconvert_4KUHD_hevc. Example 1200 equals 1200k',
    },
    {
      name: 'tagName',
      type: 'string',
      defaultValue: 'comment',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Enter the stream tag to check. By default, this metadata is added during the transcode process and no tagging options need to be changed',
    },
    {
      name: 'tagValues',
      type: 'string',
      defaultValue: 'processed',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Enter a comma separated list of tag values to check for. By default, this metadata is added during the transcode process and no tagging options need to be changed',
    },
    {
      name: 'exactMatch',
      type: 'boolean',
      defaultValue: true,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip:
      'Specify true if the property value must be an exact match,'
      + ' false if the property value must contain the value.',
    },
    {
      name: 'continueIfTagFound',
      type: 'boolean',
      defaultValue: false,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip:
        'Specify whether to continue the plugin stack if the tag is found. This should almost never be True unless you want to transcode files twice',
    },
  ],
});
// #region Helper Classes/Modules
/**
* Handles logging in a standardised way.
*/
class Log {
  constructor() {
    this.entries = [];
  }
  /**
   *
   * @param {String} entry the log entry string
   */
  Add(entry) {
    this.entries.push(entry);
  }
  /**
   *
   * @param {String} entry the log entry string
   */
  AddSuccess(entry) {
    this.entries.push(`☑ ${entry}`);
  }
  /**
   *
   * @param {String} entry the log entry string
   */
  AddError(entry) {
    this.entries.push(`☒ ${entry}`);
  }
  /**
   * Returns the log lines separated by new line delimiter.
   */
  GetLogData() {
    return this.entries.join('\n');
  }
}
/**
* Handles the storage of FFmpeg configuration.
*/
class Configurator {
  constructor(defaultOutputSettings = null) {
    this.shouldProcess = false;
    this.outputSettings = defaultOutputSettings || [];
    this.inputSettings = [];
  }
  AddInputSetting(configuration) {
    if (configuration && configuration.trim() !== '') {
        this.inputSettings.push(configuration);
    }
  }
  AddOutputSetting(configuration) {
    this.shouldProcess = true;
    if (!configuration) {
      return;
    }
    if (typeof (configuration) === 'object') {
      this.outputSettings = this.outputSettings.concat(configuration);
    } else {
      this.outputSettings.push(configuration);
    }
  }
  ResetOutputSettings() {
    this.outputSettings = [];
  }
  ResetInputSettings() {
    this.inputSettings = [];
  }
  GetOutputSettings() {
    return this.outputSettings.join(' ');
  }
  GetInputSettings() {
    return this.inputSettings.join(' ');
  }
}
/**
* @param {number} bitrateprobe - the bitrateprobe for the file
* @returns the position of the decimal
*/
function getPosition(bitrateprobe) {
  return bitrateprobe.toString().indexOf('.');
}
/**
* @param {number} bitrateprobe - the bitrateprobe for the file
* @returns an integer
*/
function parseBitrateProbe(bitrateprobe) {
  const pos = getPosition(bitrateprobe);
  if (pos === 0 || pos === -1) {
    return bitrateprobe;
  }
  return parseInt(bitrateprobe.toString().substring(0, pos));
}
/**
* @param {object} file the file object
* @returns the overall bitrate to compare too.
*/
function calculateBitrate(file) {
  try {
    let duration;
    if (file.meta && file.meta.Duration) {
      duration = file.meta.Duration;
    } else {
      duration = file.ffProbeData.format.duration;
    }
    return file.file_size / (Number(duration) * 0.0075) / 1000.0;
  } catch (err) { } // eslint-disable-line no-empty
  return 0;
}
/**
* Determine if we should abort
*/
function checkAbort(inputs, file, logger) {
  try {
    if (file.fileMedium !== 'video') {
      logger.AddError('Not a video file');
      return true;
    }
    return false;
  } catch (err) {
    logger.AddError(err);
    return true;
  }
}
/**
* function to check video stream for HDR metadata. Adapted from Migz HDR plugin.
*/
function checkHDRMetadata(stream, id, inputs, logger, configuration) {
  if (!inputs.reconvert_hdr && (stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67')) {
    logger.AddSuccess(`Stream ${id} is HDR (${stream.color_transfer}) and reconvert_hdr is disabled. Copying stream.`);
    return false;
  }
  return true;
}
/**
* loop over a type of stream
*/
function loopOverStreamsOfType(file, type, method) {
  if (file.ffProbeData.streams) {
    for (let i = 0; i < file.ffProbeData.streams.length; i += 1) {
      if (file.ffProbeData.streams[i].codec_type.toLowerCase() === type) {
        method(file.ffProbeData.streams[i], i);
      }
    }
  }
}
/**
* Video Configuration Logic
*/
function buildVideoConfiguration(inputs, file, logger) {
  const configuration = new Configurator(['-map 0', '-c:v copy', '-c:a copy', '-c:s copy']);
  const tiered = {
    '480p': {
      bitrate: inputs.target_bitrate_480p576p,
      max_increase: 100,
      cq: 27,
    },
    '576p': {
      bitrate: inputs.target_bitrate_480p576p,
      max_increase: 100,
      cq: 27,
    },
    '720p': {
      bitrate: inputs.target_bitrate_720p,
      max_increase: 200,
      cq: 26,
    },
    '1080p': {
      bitrate: inputs.target_bitrate_1080p,
      max_increase: 400,
      cq: 24,
    },
    '4KUHD': {
      bitrate: inputs.target_bitrate_4KUHD,
      max_increase: 800,
      cq: 22,
    },
  };
  // These are HWAccel decoders, thus input options
  const inputDecoderSettings = {
    h263: '-c:v h263_cuvid',
    h264: '', // Will be determined dynamically based on bit depth
    mjpeg: '-c:v mjpeg_cuvid',
    mpeg1: '-c:v mpeg1_cuvid',
    mpeg2: '-c:v mpeg2_cuvid',
    vc1: '-c:v vc1_cuvid',
    vp8: '-c:v vp8_cuvid',
    vp9: '-c:v vp9_cuvid',
    hevc: '-c:v hevc_cuvid',
  };

  function videoProcess(stream, id) {
    if (stream.codec_name === 'mjpeg') {
      configuration.AddOutputSetting(`-map -v:${id}`); // Output option
      return;
    }
    if (!checkHDRMetadata(stream, id, inputs, logger, configuration)) {
      return;
    }

    const filterBitrate480 = (inputs.hevc_480p_576p_filter_bitrate * 1000);
    const filterBitrate720 = (inputs.hevc_720p_filter_bitrate * 1000);
    const filterBitrate1080 = (inputs.hevc_1080p_filter_bitrate * 1000);
    const filterBitrate4k = (inputs.hevc_filter_bitrate_4KUHD * 1000);
    const fileResolution = file.video_resolution;
    const reconvert = inputs.reconvert_hevc;
    const res480p = '480p';
    const res576p = '576p';
    const res720p = '720p';
    const res1080p = '1080p';
    const res4k = '4KUHD';

    if (reconvert === false) {
      if (stream.codec_name === 'hevc' || stream.codec_name === 'vp9') {
        logger.AddSuccess(`Video stream ${id} is hevc, and hevc reconvert is off`);
        return;
      }
    }

    function reconvertcheck(filterbitrate, res, res2) {
      if ((filterbitrate > 0) && ((fileResolution === res) || (fileResolution === res2))) {
            if ((stream.codec_name === 'hevc' || stream.codec_name === 'vp9') && (file.bit_rate < filterbitrate)) {
            logger.AddSuccess(`Video stream ${id} bitrate is below the HEVC/VP9 filter criteria: Bitrate Criteria (${filterbitrate} kbps) > File Bitrate (${file.bit_rate} kbps)`);
            return true;
          } else if (stream.codec_name === 'hevc' || stream.codec_name === 'vp9') {
            logger.Add(`Video stream ${id} is HEVC/VP9 and its bitrate (${file.bit_rate} kbps) is above filter (${filterbitrate} kbps)`);
            }
          }
          return false;
    }

    const bool480 = reconvertcheck(filterBitrate480, res480p, res576p);
    const bool720 = reconvertcheck(filterBitrate720, res720p);
    const bool1080 = reconvertcheck(filterBitrate1080, res1080p);
    const bool4k = reconvertcheck(filterBitrate4k, res4k);
    if (bool480 === true || bool720 === true || bool1080 === true || bool4k === true) {
      return;
    }

    if (stream.codec_name === 'png') {
      configuration.AddOutputSetting(`-map -0:v:${id}`); // Output option
    } else {
      const bitrateProbe = (calculateBitrate(file) / 1000);
      let bitrateTarget = 0;
      const tier = tiered[file.video_resolution];
      if (tier == null) {
        logger.AddError('Plugin does not support the files video resolution');
        return;
      }
      const bitrateCheck = parseInt(tier.bitrate);
      if (bitrateProbe !== null && bitrateProbe < bitrateCheck) {
        bitrateTarget = parseInt(bitrateProbe * inputs.target_pct_reduction);
      } else {
        bitrateTarget = parseInt(tier.bitrate);
      }
      const bitrateMax = bitrateTarget + tier.max_increase;
      const { cq } = tier;

      // Add output video encoding settings
      configuration.AddOutputSetting(`-c:v hevc_nvenc -tag:v hvc1 -profile:v main10 -pix_fmt:v p010le -gpu 0 -surfaces 64 -qmin 0 -cq:v ${cq} -b:v ${bitrateTarget}k -maxrate:v ${bitrateMax}k -preset slow -multipass fullres -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 15 -threads 1 -metadata comment=processed`);
      
      // Add input decoder settings with 10-bit detection for H.264
      if (stream.codec_name === 'h264') {
        // Check if video is 10-bit by looking at pixel format or profile
        const is10bit = stream.pix_fmt && (
          stream.pix_fmt.includes('10le') || 
          stream.pix_fmt.includes('10be') ||
          stream.pix_fmt.includes('p010')
        ) || (stream.profile && stream.profile.toLowerCase().includes('high 10'));
        
        if (is10bit) {
          // Don't use h264_cuvid for 10-bit content - let FFmpeg use software decoder
          logger.Add(`Stream ${id} is H.264 10-bit, using software decoder (h264_cuvid doesn't support 10-bit)`);
        } else {
          // Use hardware decoder for 8-bit H.264
          configuration.AddInputSetting('-c:v h264_cuvid');
          logger.Add(`Stream ${id} is H.264 8-bit, using h264_cuvid hardware decoder`);
        }
      } else {
        // For other codecs, use the predefined decoder settings
        const decoderSetting = inputDecoderSettings[stream.codec_name];
        if (decoderSetting !== undefined && decoderSetting.trim() !== '') {
          configuration.AddInputSetting(decoderSetting);
        }
      }

      logger.Add(`Transcoding stream ${id} to HEVC using NVidia NVENC`);
    }
  }

  loopOverStreamsOfType(file, 'video', videoProcess);

  if (!configuration.shouldProcess) {
    logger.AddSuccess('No video processing necessary');
  }
  return configuration;
}
/**
* Audio, set audio to copy
*/
function buildAudioConfiguration(inputs, file, logger) {
  const configuration = new Configurator(['-c:a copy']); // Output option
  return configuration;
}
/**
* Subtitles, set subs to copy
*/
function buildSubtitleConfiguration(inputs, file, logger) {
  const configuration = new Configurator(['-c:s copy']); // Output option
  return configuration;
}
function checkTags(file, inputs) {
  const { strHasValue } = require('../methods/utils');
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  
  const response = {
    processFile: false,
    infoLog: '',
  };

  if (inputs.tagName.trim() === '') {
    response.infoLog += 'No input tagName entered in plugin, skipping \n';
    return response;
  }
  const tagName = inputs.tagName.trim();

  if (inputs.tagValues.trim() === '') {
    response.infoLog += 'No input tagValues entered in plugin, skipping \n';
    return response;
  }
  const tagValues = inputs.tagValues.trim().split(',');

  let tagFound = false;

  try {
    // --- VERIFICAÇÃO NO METADATA GLOBAL (FORMAT) ---
    if (file.ffProbeData.format?.tags && strHasValue(tagValues, file.ffProbeData.format.tags[tagName], inputs.exactMatch)) {
      tagFound = true;
      response.infoLog += `Found tag [${tagName}] in global metadata. \n`;
    }

    // --- VERIFICAÇÃO NOS STREAMS (se ainda não encontrou no global) ---
    if (!tagFound) {
      for (let i = 0; i < file.ffProbeData.streams.length; i += 1) {
        if (file.ffProbeData.streams[i]?.tags && strHasValue(tagValues, file.ffProbeData.streams[i].tags[tagName], inputs.exactMatch)) {
          tagFound = true;
          response.infoLog += `Found tag [${tagName}] in stream ${i}. \n`;
          break;
        }
      }
    }

    const message = `A tag name ${tagName} containing ${tagValues.join(',')} has`;

    if (inputs.continueIfTagFound === true) {
      response.processFile = true;
      response.infoLog += `${message} ${tagFound ? 'been' : 'not been'} found. continue_if_tag_found is True. \n`;
    } else {
      response.processFile = !tagFound;
      response.infoLog += `${message} ${tagFound ? 'been found. Skipping' : 'not been found. Continuing'}. \n`;
    }

  } catch (err) {
    console.log(err);
    response.infoLog += `Error checking tags: ${err} \n`;
    response.processFile = false;
  }
  return response;
}
// #endregion
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const { strHasValue } = require('../methods/utils');
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
  const abort = checkAbort(inputs, file, logger);
  if (abort) {
    response.processFile = false;
    response.infoLog += logger.GetLogData();
    return response;
  }

  const videoSettings = buildVideoConfiguration(inputs, file, logger);
  const audioSettings = buildAudioConfiguration(inputs, file, logger); // Primarily output settings
  const subtitleSettings = buildSubtitleConfiguration(inputs, file, logger); // Primarily output settings

  // Start with input-specific options
  // -analyzeduration and -probesize are input options
  let inputOptions = '-hwaccel cuda -analyzeduration 2147483647 -probesize 2147483647';
  const videoInputSettings = videoSettings.GetInputSettings();
  if (videoInputSettings && videoInputSettings.trim() !== '') {
    inputOptions += ` ${videoInputSettings}`;
  }

  // Consolidate all output options
  let outputOptions = videoSettings.GetOutputSettings();
  outputOptions += ` ${audioSettings.GetOutputSettings()}`;
  outputOptions += ` ${subtitleSettings.GetOutputSettings()}`;
  outputOptions += ' -max_muxing_queue_size 9999'; // This is an output option

  // b frames argument (output option)
  if (inputs.bframes === true) {
    outputOptions += ' -bf 2 -b_ref_mode middle';
  }
  
  // Construct the preset string: INPUT_OPTIONS,OUTPUT_OPTIONS
  // Ensure there's always a comma, even if inputOptions is just the probesize/analyzeduration
  response.preset = `${inputOptions.trim()},${outputOptions.trim()}`;

  response.processFile = videoSettings.shouldProcess;
  if (!response.processFile) {
    logger.AddSuccess('No need to process file');
  }
  response.infoLog += logger.GetLogData();
  return response;
};
module.exports.details = details;
module.exports.plugin = plugin;