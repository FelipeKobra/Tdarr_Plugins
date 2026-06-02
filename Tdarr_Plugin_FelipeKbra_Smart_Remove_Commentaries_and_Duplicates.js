/* eslint-disable no-await-in-loop */
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Smart Remove Commentary and Duplicate Audio Tracks',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: `Este plugin remove de forma inteligente faixas de comentários. 
    Além de analisar as tags de texto e a disposition, ele possui uma lógica inteligente: 
    se houver faixas duplicadas para o mesmo idioma, ele mantém a de maior qualidade (canais) 
    e elimina a menor (geralmente faixas de comentário cegas/sem metadados, como no RoboCop).`,
  Version: '1.0',
  Tags: 'pre-processing,configurable,audio',
  Inputs: [],
});

const response = {
  processFile: false,
  preset: '',
  container: '.',
  handBrakeMode: false,
  FFmpegMode: true,
  reQueueAfter: false,
  infoLog: '',
};

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  
  response.container = `.${file.container}`;
  response.infoLog = '=== Plugin: Remoção Inteligente de Comentários e Duplicadas (FelipeKbra) ===\n\n';
  
  if (file.fileMedium !== 'video') {
    response.processFile = false;
    response.infoLog += '☒ O arquivo não é um vídeo!\n';
    return response;
  }
  
  const audioStreams = file.ffProbeData.streams.filter(s => s.codec_type === 'audio');
  
  if (audioStreams.length === 0) {
    response.infoLog += '⚠ Nenhuma faixa de áudio encontrada.\n';
    return response;
  }
  
  response.infoLog += `📊 Total de faixas de áudio detectadas: ${audioStreams.length}\n`;
  
  // Agrupar faixas por idioma para detectar duplicidades (ex: duas faixas 'eng')
  const langGroups = {};
  
  audioStreams.forEach((stream) => {
    const lang = stream.tags?.language || 'und';
    if (!langGroups[lang]) {
      langGroups[lang] = [];
    }
    langGroups[lang].push(stream);
  });
  
  const streamsToKeep = [];
  const streamsToRemove = [];
  
  // Analisar os grupos de idiomas
  Object.keys(langGroups).forEach((lang) => {
    const streams = langGroups[lang];
    
    // Passo 1: Identificar o que é comentário explícito por texto/disposition
    const explicitCommentaries = [];
    const normalStreams = [];
    
    streams.forEach((stream) => {
      const title = stream.tags?.title || '';
      const titleLower = title.toLowerCase();
      const isCommentaryDisposition = stream.disposition?.comment === 1;
      
      const hasCommentaryKeywords = 
        titleLower.includes('commentary') || 
        titleLower.includes('comentário') || 
        titleLower.includes('comentario') || 
        titleLower.includes('director') || 
        titleLower.includes('diretor') || 
        titleLower.includes('cast ') || 
        titleLower.endsWith(' cast') ||
        titleLower === 'cast';
        
      if (isCommentaryDisposition || hasCommentaryKeywords) {
        explicitCommentaries.push(stream);
      } else {
        normalStreams.push(stream);
      }
    });
    
    // Mover comentários explícitos para a lista de remoção
    explicitCommentaries.forEach(s => {
      streamsToRemove.push(s);
      response.infoLog += `  [-] Faixa [index: ${s.index}] [${lang}] - "${s.tags?.title || 'Sem título'}" (${s.channels}ch) -> REMOVER (Metadados de Comentário explícitos)\n`;
    });
    
    // Passo 2: Lógica Inteligente para duplicados "cegos" (Ex: Caso RoboCop)
    // Se sobrarem mais de uma faixa "normal" para o mesmo idioma, comparamos a qualidade
    if (normalStreams.length > 1) {
      response.infoLog += `  🔍 Detectadas ${normalStreams.length} faixas normais para o idioma [${lang}]. Aplicando filtro de melhor qualidade...\n`;
      
      // Encontrar o maior número de canais desse idioma
      const maxChannels = Math.max(...normalStreams.map(s => s.channels || 0));
      
      // Separar a melhor das outras
      let bestStreamChosen = false;
      
      normalStreams.forEach((stream) => {
        // Se for a faixa com mais canais e ainda não escolhemos a principal do idioma, mantém
        if ((stream.channels || 0) === maxChannels && !bestStreamChosen) {
          streamsToKeep.push(stream);
          bestStreamChosen = true;
          response.infoLog += `  [+] Faixa [index: ${stream.index}] [${lang}] - "${stream.tags?.title || 'Sem título'}" (${stream.channels}ch) -> MANTER (Melhor qualidade/Canais principais)\n`;
        } else {
          // É uma faixa duplicada com menos canais e sem títulos legítimos (Cenário do RoboCop)
          streamsToRemove.push(stream);
          response.infoLog += `  [-] Faixa [index: ${stream.index}] [${lang}] - "${stream.tags?.title || 'Sem título'}" (${stream.channels}ch) -> REMOVER (Duplicada oculta/Menor qualidade)\n`;
        }
      });
    } else if (normalStreams.length === 1) {
      // Se só sobrou uma única faixa normal para aquele idioma, ela é mantida com segurança
      streamsToKeep.push(normalStreams[0]);
      response.infoLog += `  [+] Faixa [index: ${normalStreams[0].index}] [${lang}] - "${normalStreams[0].tags?.title || 'Sem título'}" (${normalStreams[0].channels}ch) -> MANTER\n`;
    }
  });
  
  // Verificação de Segurança para não deixar o arquivo mudo
  if (streamsToRemove.length === 0) {
    response.infoLog += '\n☑ Nenhuma faixa de comentário ou duplicada oculta detectada. Nada a fazer.\n';
    return response;
  }
  
  if (streamsToKeep.length === 0) {
    response.infoLog += '\n⚠ Abortando transcodificação para evitar que o arquivo final fique sem nenhuma faixa de áudio.\n';
    return response;
  }
  
  // Montagem do comando FFmpeg seguindo estritamente o seu padrão limpo
  response.preset = ',-map 0:v '; 
  response.preset += '-map 0:s? '; // Copia legendas se existirem
  
  streamsToKeep.forEach(stream => {
    response.preset += `-map 0:${stream.index} `;
  });
  
  response.preset += '-c copy ';
  
  // Garante as corretas dispositions para evitar bugs de áudio mudo ao abrir o player
  response.preset += '-disposition:a:0 default ';
  for (let i = 1; i < streamsToKeep.length; i++) {
    response.preset += `-disposition:a:${i} 0 `;
  }
  
  response.preset += '-max_muxing_queue_size 9999';
  
  response.processFile = true;
  response.infoLog += `\n☑ Concluído! Removendo ${streamsToRemove.length} faixa(s) indesejada(s). Mantendo ${streamsToKeep.length} faixa(s) principal(is).\n`;
  
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;