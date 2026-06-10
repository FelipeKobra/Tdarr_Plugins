// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Subtitles_Extractor',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Extract Subtitles and Name It Correctly Based on Brazilian or European Source',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'This plugin extracts embedded subs in one pass inside Tdarr and will optionally remove them. \n\n '
      + 'All processes happen within Tdarr without the use of any exec() functions, which lets the progress bar '
      + 'report the status correctly. AND all subtitles are extracted in one pass, which is much faster than '
      + 'other options.',
  Version: '1.07',
  Tags: 'pre-processing,subtitle only,ffmpeg,configurable',
  Inputs: [
    {
      name: 'remove_subs',
      type: 'string',
      defaultValue: 'no',
      inputUI: {
        type: 'dropdown',
        options: [
          'no',
          'yes',
        ],
      },
      tooltip: 'Do you want to remove subtitles after they are  extracted?',
    },
    {
      name: 'subtitle_codecs',
      type: 'string',
      defaultValue: 'subrip',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Comma separated ffprobe subtitle codec_name values to extract as SRT. '
        + 'Text-based codecs only. Default subrip keeps the previous behavior. '
        + 'Example: subrip,ass,ssa,text,mov_text,webvtt. Bitmap codecs such as '
        + 'hdmv_pgs_subtitle or dvd_subtitle are not supported.',
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')(); const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);
  // Must return this object at some point in the function else plugin will fail.
  const response = {
    processFile: true,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: '',
  };

  if (inputs.remove_subs === undefined) {
    response.processFile = false;
    response.infoLog += '☒ Inputs not entered! \n';
    return response;
  }

  const subtitleCodecs = String(inputs.subtitle_codecs).toLowerCase().split(',')
    .map((codec) => codec.trim())
    .filter((codec) => codec !== '');
  const subsArr = file.ffProbeData.streams.filter((row) => (
    subtitleCodecs.includes(String(row.codec_name).toLowerCase())
  ));

  if (subsArr.length === 0) {
    response.infoLog += 'No subs in file to extract!\n';
    response.processFile = false;
    return response;
  }
  response.infoLog += 'Found subs to extract!\n';

  let command = '-y <io>';
  for (let i = 0; i < subsArr.length; i += 1) {
    const subStream = subsArr[i];
    let lang = '';
    let type = '';
    let title = 'none';

    if (subStream && subStream.tags && subStream.tags.language) {
      lang = subStream.tags.language;
    }

    if (subStream && subStream.tags && subStream.tags.title) {
      title = subStream.tags.title;
    }

    // --- NOVA LÓGICA PARA IDENTIFICAÇÃO DE PT E PT-BR ---
    const langLower = lang.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (langLower === 'por' || langLower === 'pt') {
      if (titleLower.includes('brazilian') || titleLower.includes('br')) {
        lang = 'pt-BR';
      } else {
        // Se for "European" ou apenas "por" genérico, define como "pt"
        lang = 'pt';
      }
    }
    // ----------------------------------------------------

    if (subStream?.disposition?.hearing_impaired) {
      type = '.sdh';
    } 

    const { originalLibraryFile } = otherArguments;

    let subsFile = '';

    // for Tdarr V2 (2.00.05+)
    if (originalLibraryFile && originalLibraryFile.file) {
      subsFile = originalLibraryFile.file;
    } else {
      // for Tdarr V1
      subsFile = file.file;
    }
    subsFile = subsFile.split('.');
    subsFile[subsFile.length - 2] += `.${lang}${type}`;
    subsFile[subsFile.length - 1] = 'srt';
    subsFile = subsFile.join('.');

    const { index } = subStream;
    if (fs.existsSync(`${subsFile}`)) {
      response.infoLog += `${lang}${type}.srt already exists. Skipping!\n`;
    } else if (typeof title === 'string'
    && (title.toLowerCase().includes('commentary')
    || title.toLowerCase().includes('description'))) {
      response.infoLog += `Stream ${i} ${lang}.srt is a ${title} track. Skipping!\n`;
    } else {
      response.infoLog += `Extracting ${lang}${type}.srt\n`;
      command += ` -map 0:${index} "${subsFile}"`;
    }
  }

  if (command === '-y <io>') {
    response.infoLog += 'All subs already extracted!\n';
    if (inputs.remove_subs === 'no') {
      response.processFile = false;
      return response;
    }
  }

  response.preset = command;

  if (inputs.remove_subs === 'yes') {
    response.preset += ' -map 0 -map -0:s -c copy';
  }

  if (inputs.remove_subs === 'no') {
    response.preset += ' -map 0 -c copy';
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;