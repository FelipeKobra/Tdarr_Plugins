/* eslint-disable no-await-in-loop */
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Keep_Portuguese_Or_Original_Audio',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Keep Only Portuguese (BR/PT) or Original Language Audio',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: `Este plugin mantém apenas a faixa de áudio em português (brasileiro preferencial, 
    ou Portugal). Se não houver português, mantém apenas o idioma original do filme.
    Requer chave de API do TMDB para detectar o idioma original.`,
  Version: '1.1',
  Tags: 'pre-processing,configurable,audio',
  Inputs: [
    {
      name: 'tmdb_api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Chave de API do TMDB (v3). Obtenha em https://www.themoviedb.org/',
    },
    {
      name: 'radarr_api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Chave de API do Radarr (opcional, para melhor detecção).',
    },
    {
      name: 'radarr_url',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'URL do Radarr (opcional). Exemplos: 192.168.1.2:7878 ou https://radarr.example.com',
    },
    {
      name: 'sonarr_api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Chave de API do Sonarr (opcional, para séries).',
    },
    {
      name: 'sonarr_url',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'URL do Sonarr (opcional). Exemplos: 192.168.1.2:8989 ou https://sonarr.example.com',
    },
    {
      name: 'keep_undefined',
      type: 'boolean',
      defaultValue: true,
      inputUI: {
        type: 'switch',
      },
      tooltip:
        'Manter faixas sem tag de idioma (undefined/und). Recomendado: ativado.',
    },
  ],
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

// Mapeamento de códigos ISO 639-1 (alpha2) para ISO 639-2 (alpha3)
const iso639Map = {
  pt: 'por',
  en: 'eng',
  es: 'spa',
  fr: 'fre',
  de: 'ger',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi',
  cn: 'chi',
  ru: 'rus',
  ar: 'ara',
  hi: 'hin',
};

const alpha2ToAlpha3 = (alpha2) => {
  if (!alpha2) return null;
  const lower = alpha2.toLowerCase();
  return iso639Map[lower] || alpha2;
};

// Função para fazer requisições HTTPS usando módulo nativo
const httpsRequest = (url) => new Promise((resolve, reject) => {
  const https = require('https');
  const http = require('http');
  
  const urlObj = new URL(url);
  const protocol = urlObj.protocol === 'https:' ? https : http;
  
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Tdarr-Plugin',
    },
  };
  
  protocol.get(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error(`Failed to parse JSON: ${e.message}`));
      }
    });
  }).on('error', (err) => {
    reject(err);
  });
});

// Normalizar URL (adicionar http:// se necessário)
const normalizeUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `http://${url}`;
};

// Buscar idioma original via TMDB usando IMDB ID
const getTmdbOriginalLanguage = async (imdbId, apiKey) => {
  if (!imdbId || !apiKey) return null;
  
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}`
      + `?api_key=${apiKey}&language=en-US&external_source=imdb_id`;
    
    const data = await httpsRequest(url);
    const result = data.movie_results?.length > 0 
      ? data.movie_results[0] 
      : data.tv_results?.[0];
    
    return result?.original_language || null;
  } catch (error) {
    response.infoLog += `⚠ Erro ao buscar TMDB: ${error.message}\n`;
    return null;
  }
};

// Extrair IMDB ID do nome do arquivo
const extractImdbId = (filename) => {
  const idRegex = /(tt\d{7,8})/i;
  const match = filename.match(idRegex);
  return match ? match[1] : null;
};

// Buscar informações do Radarr
const getRadarrInfo = async (filename, apiKey, url) => {
  if (!apiKey || !url) return null;
  
  try {
    const encodedFilename = encodeURIComponent(filename);
    const fullUrl = `${normalizeUrl(url)}/api/v3/parse?apikey=${apiKey}&title=${encodedFilename}`;
    
    const data = await httpsRequest(fullUrl);
    
    if (data.movie) {
      response.infoLog += `✓ Encontrado no Radarr: ${data.movie.title}\n`;
      return {
        imdbId: data.movie.imdbId,
        originalLanguage: data.movie.originalLanguage?.name,
      };
    }
  } catch (error) {
    response.infoLog += `⚠ Erro ao buscar Radarr: ${error.message}\n`;
  }
  
  return null;
};

// Buscar informações do Sonarr
const getSonarrInfo = async (filename, apiKey, url) => {
  if (!apiKey || !url) return null;
  
  try {
    const encodedFilename = encodeURIComponent(filename);
    const fullUrl = `${normalizeUrl(url)}/api/v3/parse?apikey=${apiKey}&title=${encodedFilename}`;
    
    const data = await httpsRequest(fullUrl);
    
    if (data.series) {
      response.infoLog += `✓ Encontrado no Sonarr: ${data.series.title}\n`;
      return {
        imdbId: data.series.imdbId,
      };
    }
  } catch (error) {
    response.infoLog += `⚠ Erro ao buscar Sonarr: ${error.message}\n`;
  }
  
  return null;
};

// Detectar idioma original do filme
const detectOriginalLanguage = async (file, inputs) => {
  let imdbId = null;
  let originalLang = null;
  
  // Tentar Radarr primeiro
  if (inputs.radarr_api_key && inputs.radarr_url) {
    const radarrInfo = await getRadarrInfo(
      file.meta.FileName,
      inputs.radarr_api_key,
      inputs.radarr_url
    );
    
    if (radarrInfo) {
      imdbId = radarrInfo.imdbId;
      if (radarrInfo.originalLanguage) {
        const langLower = radarrInfo.originalLanguage.toLowerCase();
        if (langLower.includes('portuguese')) originalLang = 'por';
        else if (langLower.includes('english')) originalLang = 'eng';
        else if (langLower.includes('spanish')) originalLang = 'spa';
        else if (langLower.includes('french')) originalLang = 'fre';
        else if (langLower.includes('japanese')) originalLang = 'jpn';
      }
    }
  }
  
  // Tentar Sonarr se Radarr não funcionou
  if (!imdbId && inputs.sonarr_api_key && inputs.sonarr_url) {
    const sonarrInfo = await getSonarrInfo(
      file.meta.FileName,
      inputs.sonarr_api_key,
      inputs.sonarr_url
    );
    
    if (sonarrInfo) {
      imdbId = sonarrInfo.imdbId;
    }
  }
  
  // Fallback: extrair do nome do arquivo
  if (!imdbId) {
    imdbId = extractImdbId(file.meta.FileName);
    if (imdbId) {
      response.infoLog += `✓ IMDB ID encontrado no nome do arquivo: ${imdbId}\n`;
    }
  }
  
  // Buscar idioma original via TMDB
  if (imdbId && inputs.tmdb_api_key) {
    const tmdbLang = await getTmdbOriginalLanguage(imdbId, inputs.tmdb_api_key);
    if (tmdbLang) {
      originalLang = alpha2ToAlpha3(tmdbLang);
      response.infoLog += `✓ Idioma original (TMDB): ${tmdbLang} (${originalLang})\n`;
    }
  }
  
  return originalLang;
};

// Processar faixas de áudio
const processAudioTracks = (file, originalLang, keepUndefined) => {
  const audioStreams = file.ffProbeData.streams.filter(s => s.codec_type === 'audio');
  
  if (audioStreams.length === 0) {
    response.infoLog += '⚠ Nenhuma faixa de áudio encontrada\n';
    return null;
  }
  
  response.infoLog += `\n📊 Faixas de áudio encontradas: ${audioStreams.length}\n`;
  
  // Listar todas as faixas
  audioStreams.forEach((stream, idx) => {
    const lang = stream.tags?.language || 'und';
    const title = stream.tags?.title || 'sem título';
    response.infoLog += `  [${idx}] ${lang} - ${title}\n`;
  });
  
  // Procurar por faixas em português
  const ptBrStreams = audioStreams.filter(s => 
    s.tags?.language === 'por' && 
    (s.tags?.title?.toLowerCase().includes('bra') || 
     s.tags?.title?.toLowerCase().includes('br'))
  );
  
  const ptStreams = audioStreams.filter(s => s.tags?.language === 'por');
  const originalStreams = originalLang 
    ? audioStreams.filter(s => s.tags?.language === originalLang)
    : [];
  const undefinedStreams = audioStreams.filter(s => !s.tags?.language || s.tags?.language === 'und');
  
  let streamsToKeep = [];
  let reason = '';
  
  // Lógica de decisão
  if (ptBrStreams.length > 0) {
    streamsToKeep = [ptBrStreams[0]];
    reason = 'português brasileiro';
  } else if (ptStreams.length > 0) {
    streamsToKeep = [ptStreams[0]];
    reason = 'português';
  } else if (originalStreams.length > 0) {
    streamsToKeep = [originalStreams[0]];
    reason = `idioma original (${originalLang})`;
  } else if (audioStreams.length > 0) {
    streamsToKeep = [audioStreams[0]];
    reason = 'primeira faixa disponível (fallback)';
  }
  
  // Adicionar faixas undefined se configurado
  if (keepUndefined && undefinedStreams.length > 0) {
    undefinedStreams.forEach(s => {
      if (!streamsToKeep.includes(s)) {
        streamsToKeep.push(s);
      }
    });
    reason += ' + faixas sem tag de idioma';
  }
  
  return { streamsToKeep, reason, allStreams: audioStreams };
};

// Plugin principal
const plugin = async (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  
  response.container = `.${file.container}`;
  response.infoLog = '=== Plugin: Manter Português ou Original ===\n\n';
  
  // Verificar se tem API do TMDB
  if (!inputs.tmdb_api_key) {
    response.infoLog += '⚠ Chave de API do TMDB não configurada. '
      + 'A detecção do idioma original será limitada.\n\n';
  }
  
  // Detectar idioma original
  response.infoLog += '🔍 Detectando idioma original...\n';
  const originalLang = await detectOriginalLanguage(file, inputs);
  
  if (!originalLang) {
    response.infoLog += '⚠ Não foi possível detectar o idioma original. '
      + 'Usando fallback.\n';
  }
  
  // Processar faixas de áudio
  const result = processAudioTracks(file, originalLang, inputs.keep_undefined);
  
  if (!result) {
    return response;
  }
  
  const { streamsToKeep, reason, allStreams } = result;
  
  response.infoLog += `\n✓ Mantendo: ${reason}\n`;
  response.infoLog += `  Total de faixas a manter: ${streamsToKeep.length}\n`;
  
  // Se já tem apenas as faixas que queremos, não precisa processar
  if (streamsToKeep.length === allStreams.length) {
    response.infoLog += '\n☑ Arquivo já está no formato desejado. Nada a fazer.\n';
    return response;
  }
  
  // Construir comando FFmpeg - CORRIGIDO
  // No Tdarr, o preset vai DEPOIS do -i, então só incluir opções de output
  response.preset = ',-map 0:v '; // vírgula inicial é importante no Tdarr
  
  // Mapear legendas se existirem
  response.preset += '-map 0:s? ';
  
  // Mapear faixas de áudio a manter
  streamsToKeep.forEach(stream => {
    response.preset += `-map 0:${stream.index} `;
  });
  
  response.preset += '-c copy ';
  
  // Definir primeira faixa de áudio como padrão
  response.preset += '-disposition:a:0 default ';
  
  // Remover disposition das outras faixas
  for (let i = 1; i < streamsToKeep.length; i++) {
    response.preset += `-disposition:a:${i} 0 `;
  }
  
  response.preset += '-max_muxing_queue_size 9999';
  
  response.processFile = true;
  
  response.infoLog += `\n☑ Removendo ${allStreams.length - streamsToKeep.length} faixa(s) de áudio\n`;
  
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;