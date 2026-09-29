/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
// Based on Tdarr_Plugin_MC93_Migz5ConvertAudio (v2.6).
// Changes:
//  - Stereo downmix is created from ANY track with more than 2 channels
//    (2.1, 4.0, 5.0, 5.1, 6.1, 7.1, ...), not only 6/7 channel tracks.
//  - Downmixed streams get codec/channel options addressed to their own output
//    index (the original addressed the source stream and used a global -ac).
//  - Missing 2.0/5.1 layouts are checked per language, and AAC gets an explicit bitrate.
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Convert_Audio',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Convert Audio Streams',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: 'This plugin can convert any 2.0 audio track/s to AAC and can create downmixed audio tracks. '
    + 'Any track with more than 2 channels (2.1, 4.0, 5.0, 5.1, 6.1, 7.1...) is downmixed to 2.0. \n\n',
  Version: '1.1.0',
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
  {
    name: 'downmix_51',
    type: 'boolean',
    defaultValue: false,
    inputUI: {
      type: 'dropdown',
      options: [
        'false',
        'true',
      ],
    },
    tooltip: 'Also create a missing 5.1 (AC3) track from 7.1/6.1 tracks. Leave false when a later plugin'
      + ' removes 6-channel audio anyway.',
  },
  {
    name: 'aac_bitrate',
    type: 'string',
    defaultValue: '192k',
    inputUI: {
      type: 'text',
    },
    tooltip: 'Bitrate for AAC stereo tracks created or converted by this plugin (ffmpeg default is 128k).',
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

  // Existing/added layouts are tracked per language: a por 2.0 track must not stop an eng 5.1
  // track from getting its own 2.0 downmix (surround tracks may be removed later in the stack).
  const langOf = (stream) => (stream.tags?.language || 'und').toLowerCase();
  const hasLayout = (lang, channels) => audioStreams
    .some(({ stream }) => langOf(stream) === lang && stream.channels === channels);
  const added = new Set();
  const aacBitrate = /^\d+k$/.test(inputs.aac_bitrate) ? inputs.aac_bitrate : '192k';

  let ffmpegCommandInsert = '';
  let convert = false;
  // New streams are appended after every stream mapped by "-map 0", so their
  // audio output index starts after the existing audio streams.
  let nextNewAudioIdx = audioStreams.length;

  const addDownmix = (streamIndex, codec, channels, title, language) => {
    const outIdx = nextNewAudioIdx;
    nextNewAudioIdx += 1;
    const bitrate = codec === 'aac' ? `-b:a:${outIdx} ${aacBitrate} ` : '';
    ffmpegCommandInsert += `-map 0:${streamIndex} -c:a:${outIdx} ${codec} -ac:a:${outIdx} ${channels} ${bitrate}`
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
    const lang = langOf(stream);
    // Without downmix_single_track every source track gets its own downmix.
    const canAdd = (channelsOut) => !inputs.downmix_single_track || !added.has(`${lang}:${channelsOut}`);

    if (inputs.downmix === true) {
      // 7/8 channel track but no 6 channel in this language: create a 5.1 downmix.
      if (
        inputs.downmix_51 === true
        && (channels === 7 || channels === 8)
        && !hasLayout(lang, 6)
        && canAdd(6)
      ) {
        const newTitle = inputs.preserve_channel_title
          ? buildDownmixTitle(originalTitle, '5.1') : '5.1';
        addDownmix(index, 'ac3', 6, newTitle, language);
        response.infoLog += `☒Audio track is ${describeChannels(channels)}, no 6 channel exists. `
          + `Creating 6 channel "${newTitle}" from ${channels} channel. \n`;
        added.add(`${lang}:6`);
      }

      // Any track with more than 2 channels but no 2 channel in this language: create a 2.0 AAC downmix.
      if (
        channels > 2
        && !hasLayout(lang, 2)
        && canAdd(2)
      ) {
        const newTitle = inputs.preserve_channel_title
          ? buildDownmixTitle(originalTitle, '2.0') : '2.0';
        addDownmix(index, 'aac', 2, newTitle, language);
        response.infoLog += `☒Audio track is ${describeChannels(channels)}, no 2 channel exists. `
          + `Creating 2 channel "${newTitle}" from ${channels} channel. \n`;
        added.add(`${lang}:2`);
      }
    }

    if (inputs.aac_stereo === true && stream.codec_name !== 'aac' && channels === 2) {
      ffmpegCommandInsert += `-c:a:${audioIdx} aac -b:a:${audioIdx} ${aacBitrate} `;
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
