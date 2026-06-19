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

  if (inputs.remove_subs === undefined || inputs.remove_tags === undefined) {
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
        lang = 'pt';
      }
    }
    // ----------------------------------------------------

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
    subsFile = subsFile.split('.');
    subsFile[subsFile.length - 2] += `.${lang}${type}`;
    subsFile[subsFile.length - 1] = 'srt';
    subsFile = subsFile.join('.');

    const { index } = subStream;
    
    // Se o arquivo já existe (Passada 2)
    if (fs.existsSync(`${subsFile}`)) {
      response.infoLog += `${lang}${type}.srt already exists. Skipping extraction.\n`;
      
      // Executa a remoção de tags de posicionamento (ASS) e estilos (HTML)
      if (inputs.remove_tags === 'yes') {
        try {
          let content = fs.readFileSync(subsFile, 'utf8');
          // Regex 1: Remove tags ASS/SSA do tipo {\an8}, {\pos(x,y)}, etc.
          // Regex 2: Remove tags HTML do tipo <i>, <b>, <font>, etc.
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

  // Se o comando não mudou, significa que todas as legendas já foram extraídas (e limpas)
  if (command === '-y <io>') {
    response.infoLog += 'All subs already extracted and processed!\n';
    if (inputs.remove_subs === 'no') {
      response.processFile = false;
      return response;
    }
    // Se remove_subs for 'yes', agora que as legendas externas estão seguras e limpas, removemos do container
    response.preset = command + ' -map 0 -map -0:s -c copy';
    response.reQueueAfter = false;
    return response;
  }

  response.preset = command;

  // Gerenciamento de filas para a Passada 1
  if (inputs.remove_tags === 'yes') {
    // Força o Tdarr a voltar neste plugin após o FFmpeg criar os arquivos
    response.reQueueAfter = true;
    // Mantém as legendas no mkv por enquanto para que a Passada 2 saiba mapear os nomes certos
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