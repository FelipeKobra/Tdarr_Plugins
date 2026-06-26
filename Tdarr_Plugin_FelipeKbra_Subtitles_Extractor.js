/* eslint-disable */
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Subtitles_Extractor',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Extract Subtitles and Name It Correctly Based on Brazilian or European Source',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'This plugin extracts embedded subs in one pass inside Tdarr, optionally removes them, and can clean formatting tags.',
  Version: '1.08',
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
      tooltip: 'Do you want to remove subtitles from the video container after they are extracted?',
    },
    {
      name: 'remove_tags',
      type: 'string',
      defaultValue: 'yes',
      inputUI: {
        type: 'dropdown',
        options: [
          'no',
          'yes',
        ],
      },
      tooltip: 'Do you want to remove formatting tags (e.g. {\\an8}, <i>, <b>) from the extracted SRT files?',
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
  
  const response = {
    processFile: true,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: '',
  };

  // Guard clause against unassigned properties
  if (inputs.remove_subs === undefined || inputs.remove_tags === undefined) {
    response.processFile = false;
    response.infoLog += '☒ Inputs not entered! \n';
    return response;
  }

  // Parse comma-separated list of target subtitle codecs
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

    // -------------------------------------------------------------------------
    // PT AND PT-BR IDENTIFICATION LOGIC
    // -------------------------------------------------------------------------
    const langLower = lang.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (langLower === 'por' || langLower === 'pt') {
      if (titleLower.includes('brazilian') || titleLower.includes('br')) {
        lang = 'pt-BR';
      } else {
        lang = 'pt';
      }
    }
    // -------------------------------------------------------------------------

    // Append flag if track is designated for the hearing impaired (SDH)
    if (subStream?.disposition?.hearing_impaired) {
      type = '.sdh';
    } 

    const { originalLibraryFile } = otherArguments;
    let subsFile = '';

    if (originalLibraryFile && originalLibraryFile.file) {
      subsFile = originalLibraryFile.file;
    } else {
      subsFile = file.file;
    }
    
    // Construct the destination external subtitle filepath structure
    subsFile = subsFile.split('.');
    subsFile[subsFile.length - 2] += `.${lang}${type}`;
    subsFile[subsFile.length - 1] = 'srt';
    subsFile = subsFile.join('.');

    const { index } = subStream;
    
    // Executed on Pass 2 if the external file structure already exists on disk
    if (fs.existsSync(`${subsFile}`)) {
      response.infoLog += `${lang}${type}.srt already exists. Skipping extraction.\n`;
      
      // Execute regex operations to purge ASS positioning metadata and standard HTML styling syntax
      if (inputs.remove_tags === 'yes') {
        try {
          let content = fs.readFileSync(subsFile, 'utf8');
          // Regex 1: Removes ASS/SSA positioning headers such as {\an8}, {\pos(x,y)}, etc.
          // Regex 2: Removes traditional markup tags like <i>, <b>, <font>, etc.
          const cleaned = content.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '');
          fs.writeFileSync(subsFile, cleaned, 'utf8');
          response.infoLog += `☑ Removed formatting tags from ${lang}${type}.srt\n`;
        } catch (err) {
          response.infoLog += `☒ Error removing tags from ${lang}${type}.srt: ${err.message}\n`;
        }
      }
    } else if (typeof title === 'string'
    && (title.toLowerCase().includes('commentary')
    || title.toLowerCase().includes('description'))) {
      response.infoLog += `Stream ${i} ${lang}.srt is a ${title} track. Skipping!\n`;
    } else {
      response.infoLog += `Extracting ${lang}${type}.srt\n`;
      command += ` -map 0:${index} "${subsFile}"`;
    }
  }

  // If the command template string is untouched, extraction and cleanup routines are finished
  if (command === '-y <io>') {
    response.infoLog += 'All subs already extracted and processed!\n';
    if (inputs.remove_subs === 'no') {
      response.processFile = false;
      return response;
    }
    // Now that external subtitle safety layers are verified, purge them from the primary mux container
    response.preset = command + ' -map 0 -map -0:s -c copy';
    response.reQueueAfter = false;
    return response;
  }

  response.preset = command;

  // Queue workflow coordination mechanics for Pass 1 initialization
  if (inputs.remove_tags === 'yes') {
    // Force the Tdarr engine to process this plugin a second time once FFmpeg finishes operations
    response.reQueueAfter = true;
    // Retain internal tracks temporarily so Pass 2 mapping coordinates resolve filenames safely
    response.preset += ' -map 0 -c copy';
  } else {
    if (inputs.remove_subs === 'yes') {
      response.preset += ' -map 0 -map -0:s -c copy';
    } else {
      response.preset += ' -map 0 -c copy';
    }
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;