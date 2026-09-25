/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
// Based on Tdarr_Plugin_MC93_Migz5ConvertAudio (v2.6).
// Changes:
//  - Stereo downmix is created from ANY track with more than 2 channels
//    (2.1, 4.0, 5.0, 5.1, 6.1, 7.1, ...), not only 6/7 channel tracks.
//  - Downmixed streams get codec/channel options addressed to their own output
//    index (the original addressed the source stream and used a global -ac).
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Convert_Audio',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Convert Audio Streams',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: 'This plugin can convert any 2.0 audio track/s to AAC and can create downmixed audio tracks. '
    + 'Any track with more than 2 channels (2.1, 4.0, 5.0, 5.1, 6.1, 7.1...) is downmixed to 2.0. \n\n',
  Version: '1.0.0',
  Tags: 'pre-processing,ffmpeg,audio only,configurable',
  Inputs: [{
    name: 'aac_stereo',
    type: 'boolean',
    defaultValue: false,
    inputUI: {
      type: 'dropdown',
      options: [
        'false',
        'true',
      ],
    },
    tooltip: `Specify if any 2.0 audio tracks should be converted to aac for maximum compatability with devices.
                    \\nOptional.
             \\nExample:\\n
             true

             \\nExample:\\n
             false`,
  },
  {
    name: 'downmix',
    type: 'boolean',
    defaultValue: false,
    inputUI: {
      type: 'dropdown',
      options: [
        'false',
        'true',
      ],
    },
    tooltip: `Specify if downmixing should be used to create extra audio tracks.
                    \\nI.e if you have an 8ch but no 2ch or 6ch, create the missing audio tracks from the 8 ch.
                    \\nAny track with more than 2 channels (3ch, 4ch, 5ch, 6ch, 7ch, 8ch...) creates a missing 2ch.
             \\nExample:\\n
             true

             \\nExample:\\n
             false`,
  },
  {
    name: 'downmix_single_track',
    type: 'boolean',
    defaultValue: false,
    inputUI: {
      type: 'dropdown',
      options: [
        'false',
        'true',
      ],
    },
    tooltip: 'By default this plugin will downmix each track. '
    + 'So four 6 channel tracks will result in four 2 channel tracks.'
    + ' Enable this option to only downmix a single track.',
  },
  {
    name: 'preserve_channel_title',
    type: 'boolean',
    defaultValue: false,
    inputUI: {
      type: 'dropdown',
      options: [
        'false',
        'true',
      ],
    },
    tooltip: 'Specify whether downmixed tracks should preserve the original track title.'
      + ' \\nWhen false (default), downmixed tracks use only the new channel layout as the title'
      + ' (e.g. "2.0" or "5.1").'
      + ' \\nWhen true, the new layout is appended to the original title'
      + ' (e.g. "E-AC-3 Atmos 5.1 - 2.0").'
      + ' \\nExample:\\n\nfalse\n\n\\nExample:\\n\ntrue',
  },
  ],
});

const CHANNEL_LAYOUT_NAMES = {
  3: '2.1',
  4: '4.0',
  5: '5.0',
  6: '5.1',
  7: '6.1',
  8: '7.1',
};

const describeChannels = (channels) => CHANNEL_LAYOUT_NAMES[channels] || `${channels} channel`;

// Build a downmix title that appends the new channel layout, but avoids
// appending a layout the source title already ends with (e.g. don't turn
// "Anglais E-AC3 2.0" into "Anglais E-AC3 2.0 - 2.0").
const buildDownmixTitle = (originalTitle, layout) => {
  if (!originalTitle) return layout;
  const escaped = layout.replace(/\./g, '\\.');
  if (new RegExp(`(?:^|[^0-9.])${escaped}$`).test(originalTitle)) {
    return originalTitle;
  }
  return `${originalTitle} - ${layout}`;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    processFile: false,
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: '',
  };

  //  Check if both inputs.aac_stereo AND inputs.downmix have been left empty. If they have then exit plugin.
  if (inputs && inputs.aac_stereo === '' && inputs.downmix === '') {
    response.infoLog += '☒Plugin has not been configured, please configure required options. Skipping this plugin. \n';
    response.processFile = false;
    return response;
  }

  // Check if file is a video. If it isn't then exit plugin.
  if (file.fileMedium !== 'video') {
    response.infoLog += '☒File is not video. \n';
    response.processFile = false;
    return response;
  }

  const audioStreams = file.ffProbeData.streams
    .map((stream, index) => ({ stream, index }))
    .filter(({ stream }) => (stream.codec_type || '').toLowerCase() === 'audio');

  const has2Channel = audioStreams.some(({ stream }) => stream.channels === 2);
  const has6Channel = audioStreams.some(({ stream }) => stream.channels === 6);

  let ffmpegCommandInsert = '';
  let convert = false;
  let is2channelAdded = false;
  let is6channelAdded = false;
  // New streams are appended after every stream mapped by "-map 0", so their
  // audio output index starts after the existing audio streams.
  let nextNewAudioIdx = audioStreams.length;

  const addDownmix = (streamIndex, codec, channels, title, language) => {
    const outIdx = nextNewAudioIdx;
    nextNewAudioIdx += 1;
    ffmpegCommandInsert += `-map 0:${streamIndex} -c:a:${outIdx} ${codec} -ac:a:${outIdx} ${channels} `
      + `-metadata:s:a:${outIdx} "title=${title}" `;
    if (language) {
      ffmpegCommandInsert += `-metadata:s:a:${outIdx} "language=${language}" `;
    }
    convert = true;
  };

  audioStreams.forEach(({ stream, index }, audioIdx) => {
    const { channels } = stream;
    // Strip characters that would break the ffmpeg command-line quoting.
    const originalTitle = (stream.tags?.title || '').replace(/["`$\\]/g, '');
    const language = (stream.tags?.language || '').replace(/["`$\\]/g, '');

    if (inputs.downmix === true) {
      // 7/8 channel track but no 6 channel: create a 5.1 downmix.
      if (
        (channels === 7 || channels === 8)
        && has6Channel === false
        && (inputs.downmix_single_track === false || is6channelAdded === false)
      ) {
        const newTitle = inputs.preserve_channel_title
          ? buildDownmixTitle(originalTitle, '5.1') : '5.1';
        addDownmix(index, 'ac3', 6, newTitle, language);
        response.infoLog += `☒Audio track is ${describeChannels(channels)}, no 6 channel exists. `
          + `Creating 6 channel "${newTitle}" from ${channels} channel. \n`;
        is6channelAdded = true;
      }

      // Any track with more than 2 channels but no 2 channel: create a 2.0 AAC downmix.
      if (
        channels > 2
        && has2Channel === false
        && (inputs.downmix_single_track === false || is2channelAdded === false)
      ) {
        const newTitle = inputs.preserve_channel_title
          ? buildDownmixTitle(originalTitle, '2.0') : '2.0';
        addDownmix(index, 'aac', 2, newTitle, language);
        response.infoLog += `☒Audio track is ${describeChannels(channels)}, no 2 channel exists. `
          + `Creating 2 channel "${newTitle}" from ${channels} channel. \n`;
        is2channelAdded = true;
      }
    }

    if (inputs.aac_stereo === true && stream.codec_name !== 'aac' && channels === 2) {
      ffmpegCommandInsert += `-c:a:${audioIdx} aac `;
      response.infoLog += '☒Audio track is 2 channel but is not AAC. Converting. \n';
      convert = true;
    }
  });

  if (convert === true) {
    response.processFile = true;
    response.preset = `, -map 0 -c:v copy -c:a copy ${ffmpegCommandInsert} `
    + '-strict -2 -c:s copy -max_muxing_queue_size 9999 ';
  } else {
    response.infoLog += '☑File contains all required audio formats. \n';
    response.processFile = false;
  }
  return response;
};
module.exports.details = details;
module.exports.plugin = plugin;
