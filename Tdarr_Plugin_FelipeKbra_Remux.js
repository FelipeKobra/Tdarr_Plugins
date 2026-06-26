/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */

const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Remux',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Remux + Web Optimize Check',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'Remuxes to mkv/mp4 and ensures MP4 is "Streamable" (FastStart) for optimized web streaming in Jellyfin/Plex.',
  Version: '1.4',
  Tags: 'pre-processing,ffmpeg,video only,configurable',
  Inputs: [
    {
      name: 'container',
      type: 'string',
      defaultValue: 'mkv',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify output container of file. mkv or mp4.',
    },
    {
      name: 'force_conform',
      type: 'boolean',
      defaultValue: false,
      inputUI: {
        type: 'dropdown',
        options: [
          'false',
          'true',
        ],
      },
      tooltip: `Make the file conform to output container requirements.
                 \n Drop hdmv_pgs_subtitle/eia_608/subrip/timed_id3 for MP4.
                 \n Drop data streams/mov_text/eia_608/timed_id3 for MKV.
                 \n Default is false.`,
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  // eslint-disable-next-line no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);

  const response = {
    processFile: false,
    preset: '',
    container: `.${inputs.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: '',
  };

  // Check if inputs.container has been configured
  if (!inputs.container) {
    response.infoLog += '☒ Error: Output container not specified. Skipping. \n';
    return response;
  }

  // Check if file is a valid video medium
  if (file.fileMedium !== 'video') {
    response.infoLog += '☒ Info: File is not a video. Skipping. \n';
    return response;
  }

  const isMp4Output = inputs.container.toLowerCase() === 'mp4';
  const isMkvOutput = inputs.container.toLowerCase() === 'mkv';
  
  let extraArguments = '';
  let inputArguments = '';
  let needsProcessing = false;

  // -------------------------------------------------------------------------
  // 1. WEB OPTIMIZATION CHECK (FastStart)
  // -------------------------------------------------------------------------
  let currentIsStreamable = 'Yes';
  if (file.mediaInfo && file.mediaInfo.track && file.mediaInfo.track[0]) {
    // MediaInfo returns IsStreamable "No" if the Moov Atom is located at the end of the file binary
    currentIsStreamable = file.mediaInfo.track[0].IsStreamable || 'Yes';
  }

  if (isMp4Output && currentIsStreamable === 'No') {
    response.infoLog += '☒ Warning: MP4 detected with FastStart disabled (IsStreamable="No"). \n';
    needsProcessing = true;
  }

  // -------------------------------------------------------------------------
  // 2. CONTAINER CHECK
  // -------------------------------------------------------------------------
  if (file.container !== inputs.container) {
    response.infoLog += `☒ Info: Current container is ${file.container}, requested ${inputs.container}. \n`;
    needsProcessing = true;
  }

  // -------------------------------------------------------------------------
  // 3. CONFORMITY LOGIC (force_conform)
  // -------------------------------------------------------------------------
  const forceConform = String(inputs.force_conform) === 'true';

  if (forceConform) {
    response.infoLog += '⚙ Info: Force Conform is enabled. Checking for incompatible streams... \n';
    
    if (isMkvOutput) {
      // Remove generic Data tracks entirely for native MKV safety layout compliance
      extraArguments += '-map -0:d ';
      for (let i = 0; i < file.ffProbeData.streams.length; i++) {
        const codec = (file.ffProbeData.streams[i].codec_name || '').toLowerCase();
        if (['mov_text', 'eia_608', 'timed_id3'].includes(codec)) {
          response.infoLog += `  - Removing incompatible MKV stream [${i}]: ${codec} \n`;
          // Append negative stream mappings to explicitly strip the track
          extraArguments += `-map -0:${i} `;
          needsProcessing = true;
        }
      }
    }

    if (isMp4Output) {
      // Remove incompatible subtitle, captions, or timed telemetry data types from MP4 specification structures
      for (let i = 0; i < file.ffProbeData.streams.length; i++) {
        const codec = (file.ffProbeData.streams[i].codec_name || '').toLowerCase();
        if (['hdmv_pgs_subtitle', 'eia_608', 'subrip', 'timed_id3'].includes(codec)) {
          response.infoLog += `  - Removing incompatible MP4 stream [${i}]: ${codec} \n`;
          // Append negative stream mappings to explicitly strip the track
          extraArguments += `-map -0:${i} `;
          needsProcessing = true;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. PRE-FFMPEG FLAGS (Fixing timestamps for legacy formats)
  // -------------------------------------------------------------------------
  const legacyContainers = ['ts', 'avi', 'mpg', 'mpeg', 'vob'];
  if (legacyContainers.includes(file.container.toLowerCase())) {
    response.infoLog += '⚙ Info: Legacy container detected. Adding +genpts flag to fix missing or broken timestamps. \n';
    inputArguments = '-fflags +genpts';
  }

  // -------------------------------------------------------------------------
  // FINAL DECISION AND PRESET ASSEMBLY
  // -------------------------------------------------------------------------
  if (!needsProcessing) {
    response.infoLog += `☑ Success: File is already in ${inputs.container} and optimized for web. No action needed. \n`;
    return response;
  }

  // We use -map 0 to match all tracks by default, then negative maps in extraArguments override and exclude targets
  let outputFlags = `-map 0 -c copy -max_muxing_queue_size 9999 ${extraArguments}`;
  
  if (isMp4Output) {
    // Relocate the moov atom header structure to the front of the output stream file block
    outputFlags += ' -movflags +faststart';
    response.infoLog += '⚙ Info: Applying +faststart for MP4 streaming compatibility. \n';
  }

  response.preset = `${inputArguments},${outputFlags}`;
  response.processFile = true;
  response.infoLog += `✔ Remuxing file to ${inputs.container}... \n`;

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;