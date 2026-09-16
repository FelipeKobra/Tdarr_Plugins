/* eslint-disable */
module.exports.dependencies = ['@cospired/i18n-iso-languages@4.2.0'];

const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_Keep_Native_Lang_Plus_Eng',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - Remove All Langs Except Native And English',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: `This plugin will remove all language audio tracks except the 'native'
     (requires TMDB api key) and English.
    'Native' languages are the ones that are listed on imdb/tmdb. It does an API call to 
    Radarr/Sonarr to check if the movie/series exists and grabs the IMDB id. As a last resort it 
    falls back to the IMDB id in the filename.`,
  Version: '2.0.0',
  Tags: '3rd party,pre-processing,configurable,audio,languages',
  Inputs: [
    {
      name: 'user_langs',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Input a comma separated list of ISO-639-2 languages. It will still keep English and undefined tracks.'
        + '(https://en.wikipedia.org/wiki/List_of_ISO_639-2_codes 639-2 column)'
        + '\\nExample:\\n'
        + 'por,nld',
    },
    {
      name: 'priority',
      type: 'string',
      defaultValue: 'sonarr',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Priority for either Radarr or Sonarr. Leaving it empty defaults to Radarr first.'
        + '\\nExample:\\n'
        + 'sonarr',
    },
    {
      name: 'api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Input your TMDB api (v3) key here. (https://www.themoviedb.org/)',
    },
    {
      name: 'radarr_api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Input your Radarr api key here.',
    },
    {
      name: 'radarr_url',
      type: 'string',
      defaultValue: 'radarr:7878',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Input your Radarr url here. Supports http://, https://, or host:port'
        + '\\nExamples:\\n'
        + 'radarr:7878 or http://192.168.1.2:7878',
    },
    {
      name: 'sonarr_api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Input your Sonarr api key here.',
    },
    {
      name: 'sonarr_url',
      type: 'string',
      defaultValue: 'sonarr:8989',
      inputUI: {
        type: 'text',
      },
      tooltip:
        'Input your Sonarr url here. Supports http://, https://, or host:port'
        + '\\nExamples:\\n'
        + 'sonarr:8989 or http://192.168.1.2:8989',
    },
  ],
});

const response = {
  processFile: false,
  preset: ', -map 0 ',
  container: '.',
  handBrakeMode: false,
  FFmpegMode: true,
  reQueueAfter: false,
  infoLog: '',
};

/**
 * Funcao auxiliar para requisicoes HTTP/HTTPS nativas do Node.js
 */
const makeRequest = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');

    const defaultHeaders = {
      'User-Agent': 'Tdarr-Plugin',
      'Accept': 'application/json',
    };

    const requestOptions = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    };

    const req = lib.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsedData });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
};

// Normaliza URLs adicionando protocolo se ausente
const normalizeUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `http://${url}`;
};

const processStreams = (result, file, user_langs) => {
  const languages = require('@cospired/i18n-iso-languages');
  const tracks = {
    keep: [],
    remove: [],
    remLangs: '',
  };
  let streamIndex = 0;

  const langsTemp = result.original_language === 'cn' ? 'zh' : result.original_language;
  let langs = [];

  const alpha3 = languages.alpha2ToAlpha3B(langsTemp);
  if (alpha3) langs.push(alpha3);

  response.infoLog += `Original language: ${langsTemp}, Using code: ${alpha3}\n`;

  if (user_langs) {
    langs = langs.concat(user_langs);
  }
  if (!langs.includes('eng')) langs.push('eng');
  if (!langs.includes('und')) langs.push('und');

  response.infoLog += 'Keeping languages: ';
  langs.forEach((l) => {
    response.infoLog += `${languages.getName(l, 'en') || l}, `;
  });

  response.infoLog = `${response.infoLog.slice(0, -2)}\n`;

  for (const stream of file.ffProbeData.streams) {
    if (stream.codec_type === 'audio') {
      if (!stream.tags) {
        response.infoLog += `☒No tags found on audio track ${streamIndex}. Keeping it. \n`;
        tracks.keep.push(streamIndex);
        streamIndex += 1;
        continue;
      }
      if (stream.tags.language) {
        if (langs.includes(stream.tags.language)) {
          tracks.keep.push(streamIndex);
        } else {
          tracks.remove.push(streamIndex);
          response.preset += `-map -0:a:${streamIndex} `;
          tracks.remLangs += `${languages.getName(stream.tags.language, 'en') || stream.tags.language}, `;
        }
        streamIndex += 1;
      } else {
        response.infoLog += `☒No language tag found on audio track ${streamIndex}. Keeping it. \n`;
      }
    }
  }
  response.preset += ' -c copy -max_muxing_queue_size 9999';
  return tracks;
};

const tmdbApi = async (filename, api_key) => {
  let fileName;
  if (filename) {
    if (filename.slice(0, 2) === 'tt') {
      fileName = filename;
    } else {
      const idRegex = /(tt\d{7,8})/;
      const fileMatch = filename.match(idRegex);
      if (fileMatch) fileName = fileMatch[1];
    }
  }

  if (fileName) {
    try {
      const url = `https://api.themoviedb.org/3/find/${fileName}?api_key=${api_key}&language=en-US&external_source=imdb_id`;
      const res = await makeRequest(url, { method: 'GET' });

      if (res.status === 200 && res.data) {
        const result = (res.data.movie_results && res.data.movie_results.length > 0)
          ? res.data.movie_results[0]
          : (res.data.tv_results && res.data.tv_results.length > 0 ? res.data.tv_results[0] : null);

        if (!result) {
          response.infoLog += '☒No IMDB result was found on TMDB. \n';
        }
        return result;
      }
    } catch (e) {
      response.infoLog += `☒Error fetching TMDB API: ${e.message} \n`;
    }
  }
  return null;
};

const parseArrResponse = (body, arr) => {
  if (!body) return null;
  switch (arr) {
    case 'radarr':
      return body.movie;
    case 'sonarr':
      return body.series;
    default:
      return null;
  }
};

const plugin = async (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);

  response.container = `.${file.container}`;
  let prio = ['radarr', 'sonarr'];
  let radarrResult = null;
  let sonarrResult = null;
  let tmdbResult = null;

  if (inputs.priority && inputs.priority.toLowerCase() === 'sonarr') {
    prio = ['sonarr', 'radarr'];
  }

  const fileNameEncoded = encodeURIComponent(file.meta.FileName);

  for (const arr of prio) {
    let imdbId;
    switch (arr) {
      case 'radarr':
        if (tmdbResult) break;
        if (inputs.radarr_api_key) {
          try {
            const url = `${normalizeUrl(inputs.radarr_url)}/api/v3/parse?apikey=${inputs.radarr_api_key}&title=${fileNameEncoded}`;
            const res = await makeRequest(url, { method: 'GET' });

            if (res.status === 200 && res.data) {
              radarrResult = parseArrResponse(res.data, 'radarr');
            } else {
              response.infoLog += `☒Radarr returned status ${res.status}\n`;
            }
          } catch (e) {
            response.infoLog += `☒Error connecting to Radarr: ${e.message}\n`;
          }

          if (radarrResult) {
            imdbId = radarrResult.imdbId;
            response.infoLog += `Grabbed ID (${imdbId}) from Radarr \n`;
            const languages = require('@cospired/i18n-iso-languages');
            if (radarrResult.originalLanguage && radarrResult.originalLanguage.name) {
              tmdbResult = { original_language: languages.getAlpha2Code(radarrResult.originalLanguage.name, 'en') };
            }
          } else {
            response.infoLog += "Couldn't grab ID from Radarr \n";
            imdbId = fileNameEncoded;
          }
        }
        break;

      case 'sonarr':
        if (tmdbResult) break;
        if (inputs.sonarr_api_key) {
          try {
            const url = `${normalizeUrl(inputs.sonarr_url)}/api/v3/parse?apikey=${inputs.sonarr_api_key}&title=${fileNameEncoded}`;
            const res = await makeRequest(url, { method: 'GET' });

            if (res.status === 200 && res.data) {
              sonarrResult = parseArrResponse(res.data, 'sonarr');
            } else {
              response.infoLog += `☒Sonarr returned status ${res.status}\n`;
            }
          } catch (e) {
            response.infoLog += `☒Error connecting to Sonarr: ${e.message}\n`;
          }

          if (sonarrResult) {
            imdbId = sonarrResult.imdbId;
            response.infoLog += `Grabbed ID (${imdbId}) from Sonarr \n`;
          } else {
            response.infoLog += "Couldn't grab ID from Sonarr \n";
            imdbId = fileNameEncoded;
          }

          if (inputs.api_key) {
            tmdbResult = await tmdbApi(imdbId, inputs.api_key);
          }
        }
        break;
    }
  }

  if (tmdbResult) {
    const tracks = processStreams(
      tmdbResult,
      file,
      inputs.user_langs ? inputs.user_langs.split(',') : '',
    );

    if (tracks.remove.length > 0) {
      if (tracks.keep.length > 0) {
        response.infoLog += `☑Removing tracks with languages: ${tracks.remLangs.slice(0, -2)}. \n`;
        response.processFile = true;
        response.infoLog += '\n';
      } else {
        response.infoLog += '☒Cancelling plugin otherwise all audio tracks would be removed. \n';
      }
    } else {
      response.infoLog += '☒No audio tracks to be removed. \n';
    }
  } else {
    response.infoLog += "☒Couldn't find the IMDB id of this file. Skipping. \n";
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;