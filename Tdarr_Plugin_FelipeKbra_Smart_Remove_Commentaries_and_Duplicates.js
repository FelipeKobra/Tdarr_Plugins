/* eslint-disable no-param-reassign */
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Smart Remove Commentary and Duplicate Audio Tracks',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: 'Remove comentários explícitos e faixas duplicadas (como AC3 2ch cego), protegendo a cadeia de downmix (8ch, 6ch e AAC 2ch).',
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

  if (file.fileMedium !== 'video') return response;

  const audioStreams = file.ffProbeData.streams.filter(s => s.codec_type === 'audio');
  if (audioStreams.length === 0) return response;

  // Agrupa faixas por idioma
  const langGroups = {};
  audioStreams.forEach(s => {
    const lang = s.tags?.language || 'und';
    langGroups[lang] = langGroups[lang] || [];
    langGroups[lang].push(s);
  });

  const streamsToKeep = [];
  const streamsToRemove = [];

  Object.keys(langGroups).forEach(lang => {
    const streams = langGroups[lang];
    const maxChannels = Math.max(...streams.map(s => s.channels || 0));

    streams.forEach(stream => {
      const title = (stream.tags?.title || '').toLowerCase();
      const codec = (stream.codec_name || '').toLowerCase();
      const channels = stream.channels || 0;

      // 1. Se tiver marcação explícita de comentário, remove direto
      const isCommentary = stream.disposition?.comment === 1 || 
        ['commentary', 'comentário', 'comentario', 'director', 'diretor', 'cast'].some(k => title.includes(k));

      if (isCommentary) {
        streamsToRemove.push(stream);
        response.infoLog += `[-] Removendo comentário explícito: [${lang}] index ${stream.index}\n`;
        return;
      }

      // Se só existir uma faixa no idioma, mantém para não ficar mudo
      if (streams.length === 1) {
        streamsToKeep.push(stream);
        return;
      }

      // 2. Filtro de Duplicadas (Protege o seu Downmix e deleta o AC3 do RoboCop)
      const isMainTrack = channels === maxChannels;
      const isIntermediateDownmix = channels >= 6; // Mantém faixas 5.1/6.1 legítimas mesmo se houver 7.1/8ch
      const isLegitDownmix = codec === 'aac' || title.includes('2.0') || title.includes('stereo');

      if (isMainTrack || isIntermediateDownmix || isLegitDownmix) {
        streamsToKeep.push(stream);
      } else {
        // Faixa menor sem nenhuma identificação (ex: AC3 2ch cego original) -> REMOVE
        streamsToRemove.push(stream);
        response.infoLog += `[-] Removendo duplicada cega: [${lang}] index ${stream.index} (${channels}ch ${codec})\n`;
      }
    });
  });

  if (streamsToRemove.length === 0 || streamsToKeep.length === 0) {
    return response; // Nada a fazer ou evita deixar arquivo mudo
  }

  // Monta o comando FFmpeg limpo
  response.preset = ',-map 0:v -map 0:s? ';
  streamsToKeep.forEach(s => { response.preset += `-map 0:${s.index} `; });
  response.preset += '-c copy -max_muxing_queue_size 9999';

  // Ajusta as Dispositions de áudio padrão de forma simples
  response.preset += ' -disposition:a:0 default';
  for (let i = 1; i < streamsToKeep.length; i++) {
    response.preset += ` -disposition:a:${i} 0`;
  }

  response.processFile = true;
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;