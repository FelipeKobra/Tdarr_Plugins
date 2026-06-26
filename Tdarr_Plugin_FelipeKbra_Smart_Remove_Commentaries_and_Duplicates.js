/* eslint-disable no-param-reassign */
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Smart Remove Commentary and Duplicate Audio Tracks',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: 'Removes explicit commentary and duplicate tracks (such as blind 2ch AC3), protecting the downmix chain (8ch, 6ch, and 2ch AAC).',
  Version: '1.2',
  Tags: 'pre-processing,audio',
  Inputs: [],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);

  const response = {
    processFile: false,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: '=== FelipeKbra Smart Audio Cleaner ===\n',
  };

  // Abort if the processed medium is not recognized as a video asset
  if (file.fileMedium !== 'video') return response;

  // Filter and isolate all audio streams from ffProbe data
  const audioStreams = file.ffProbeData.streams.filter(s => s.codec_type === 'audio');
  if (audioStreams.length === 0) return response;

  // Group audio tracks by their respective ISO language codes
  const langGroups = {};
  audioStreams.forEach(s => {
    const lang = s.tags?.language || 'und';
    langGroups[lang] = langGroups[lang] || [];
    langGroups[lang].push(s);
  });

  const streamsToKeep = [];
  const streamsToRemove = [];

  // Iterate over each language pool to safely parse tracks
  Object.keys(langGroups).forEach(lang => {
    const streams = langGroups[lang];
    const maxChannels = Math.max(...streams.map(s => s.channels || 0));

    streams.forEach(stream => {
      const title = (stream.tags?.title || '').toLowerCase();
      const codec = (stream.codec_name || '').toLowerCase();
      const channels = stream.channels || 0;

      // -----------------------------------------------------------------------
      // 1. Explicit Commentary Detection Filter
      // -----------------------------------------------------------------------
      const isCommentary = stream.disposition?.comment === 1 || 
        ['commentary', 'comentário', 'comentario', 'director', 'diretor', 'cast'].some(k => title.includes(k));

      if (isCommentary) {
        streamsToRemove.push(stream);
        response.infoLog += `[-] Removing explicit commentary: [${lang}] index ${stream.index}\n`;
        return;
      }

      // Safety fallback: if it is the only track available for this language, keep it to avoid complete muting
      if (streams.length === 1) {
        streamsToKeep.push(stream);
        return;
      }

      // -----------------------------------------------------------------------
      // 2. Duplicate Detection Filter (Protects clean downmix chains and strips metadata-less tracks)
      // -----------------------------------------------------------------------
      const isMainTrack = channels === maxChannels;
      const isIntermediateDownmix = channels >= 6; // Preserves legitimate 5.1/6.1 audio streams even when a 7.1/8ch track exists
      const isLegitDownmix = codec === 'aac' || title.includes('2.0') || title.includes('stereo');

      if (isMainTrack || isIntermediateDownmix || isLegitDownmix) {
        streamsToKeep.push(stream);
      } else {
        // Track has a smaller channel count with no explicit descriptors (e.g., a blind legacy 2ch AC3) -> REMOVE
        streamsToRemove.push(stream);
        response.infoLog += `[-] Removing blind duplicate track: [${lang}] index ${stream.index} (${channels}ch ${codec})\n`;
      }
    });
  });

  // Verify if actions are required or if discarding tracks would leave the video without any audio streams
  if (streamsToRemove.length === 0 || streamsToKeep.length === 0) {
    return response; 
  }

  // -----------------------------------------------------------------------
  // FFmpeg Command Construction
  // -----------------------------------------------------------------------
  // Map all video and optional subtitle tracks first
  response.preset = ',-map 0:v -map 0:s? ';
  
  // Map explicitly selected clean audio streams back into the container
  streamsToKeep.forEach(s => { response.preset += `-map 0:${s.index} `; });
  response.preset += '-c copy -max_muxing_queue_size 9999';

  // Adjust audio stream routing configurations to enforce the first clean track as default
  response.preset += ' -disposition:a:0 default';
  for (let i = 1; i < streamsToKeep.length; i++) {
    response.preset += ` -disposition:a:${i} 0`;
  }

  response.processFile = true;
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;