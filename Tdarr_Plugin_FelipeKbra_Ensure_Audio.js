const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Ensure_Audio',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Ensure Audio Was Not Removed',
  Type: 'Audio',
  Operation: 'Filter',
  Description: 'Safety net for the audio cleanup plugins. If the original library file had audio and the '
    + 'working file has none left, the job is errored, so Tdarr keeps the original file untouched. '
    + 'Place it after the last plugin that removes audio streams.',
  Version: '1.0',
  Tags: 'pre-processing,audio,filter',
  Inputs: [],
});

const countAudio = (probe) => ((probe && probe.streams) || [])
  .filter((stream) => (stream.codec_type || '').toLowerCase() === 'audio').length;

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  // eslint-disable-next-line no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    processFile: false,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: '',
  };

  if (file.fileMedium !== 'video') return response;

  const original = otherArguments && otherArguments.originalLibraryFile;
  const originalAudio = countAudio(original && original.ffProbeData);
  const currentAudio = countAudio(file.ffProbeData);

  if (originalAudio > 0 && currentAudio === 0) {
    // Item will be errored in UI and the original file is kept.
    throw new Error(`All audio streams were removed (original had ${originalAudio}). `
      + 'Aborting so the original file is not replaced.');
  }

  response.infoLog += `☑Audio streams: ${currentAudio} (original had ${originalAudio}). \n`;
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
