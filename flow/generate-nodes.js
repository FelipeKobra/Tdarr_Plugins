// Writes the FelipeKbra local flow plugins. Usage: node flow-gen.js <LocalFlowPlugins dir>
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root || !fs.existsSync(root)) throw new Error('LocalFlowPlugins dir missing');

const input = (name, defaultValue, tooltip) => ({ label: name, name, type: 'string', defaultValue, inputUI: { type: 'text' }, tooltip });
const PRELUDE = String.raw`"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var flowUtils_1 = require("../../../../FlowHelpers/1.0.0/interfaces/flowUtils");
var active = function (args) { return args.variables.ffmpegCommand.streams.filter(function (s) { return !s.removed; }); };
var ofType = function (type) { return function (s) { return (s.codec_type || '').toLowerCase() === type; }; };
var isAudio = ofType('audio');
var isSubtitle = ofType('subtitle');
var codecOf = function (s) { return (s.codec_name || '').toLowerCase(); };
var splitList = function (v) { return String(v).split(',').map(function (i) { return i.trim(); }).filter(Boolean); };
var markRemoved = function (streams) { streams.forEach(function (s) { s.removed = true; }); };
var next = function (args) { return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables }; };
`;

const VIDEO_HELPERS = String.raw`
var AUDIO_KBPS_PER_CHANNEL = { truehd: 400, flac: 400, pcm_s16le: 400, pcm_s24le: 400, dts: 256, eac3: 110, ac3: 110, aac: 64 };
var tagKbps = function (s) {
  var bps = Number(s.bit_rate || (s.tags && (s.tags.BPS || s.tags['BPS-eng'])));
  return Number.isFinite(bps) && bps > 0 ? bps / 1000 : null;
};
var isCover = function (s) { return (s.disposition && Number(s.disposition.attached_pic) === 1) || ['mjpeg', 'png', 'bmp', 'gif'].includes(s.codec_name); };
var mainVideo = function (args) { return active(args).find(function (s) { return ofType('video')(s) && !isCover(s); }); };
// Nothing is rewritten yet, so the audio that the old stack had already cleaned is subtracted here.
var videoKbps = function (args, video) {
  var direct = tagKbps(video);
  if (direct) return direct;
  var probe = args.inputFileObj.ffProbeData;
  var total = Number(probe.format && probe.format.bit_rate) / 1000;
  if (!Number.isFinite(total) || total <= 0) return null;
  var audio = probe.streams.filter(isAudio).reduce(function (sum, s) {
    return sum + (tagKbps(s) || (AUDIO_KBPS_PER_CHANNEL[s.codec_name] || 64) * (s.channels || 2));
  }, 0);
  return total > audio ? total - audio : null;
};
var addVideoEncode = function (args, video, hwDecode, filters, rateArgs) {
  var command = args.variables.ffmpegCommand;
  command.overallInputArguments.push.apply(command.overallInputArguments, hwDecode
    ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : ['-init_hw_device', 'cuda=cu:0', '-filter_hw_device', 'cu']);
  // Like the old plugins: only the main video, audio, subtitles and attachments go through an encode.
  markRemoved(active(args).filter(function (s) { return (ofType('video')(s) && s !== video) || ofType('data')(s); }));
  video.outputArgs.push.apply(video.outputArgs, ['-c:v:0', 'hevc_nvenc', '-gpu', '0', '-profile:v:0', 'main10', '-vf', filters,
    '-preset', 'p7', '-tune', 'hq', '-multipass', 'fullres'].concat(rateArgs, ['-metadata:s:v:0', 'COPYRIGHT=processed']));
};
`;

const plugins = {
removeImages: { name: 'FK: Remove Image Streams', desc: 'Same rule as MigzImageRemoval, in memory.', inputs: [], body: String.raw`
  markRemoved(active(args).filter(function (s) { return ofType('video')(s) && ['mjpeg', 'png', 'gif'].includes(s.codec_name); }));` },

cleanSubtitles: { name: 'FK: Clean Subtitles', desc: 'Same rules as Migz4CleanSubs: language list, commentary, description, SDH and missing language tag.',
  inputs: [input('languages', 'eng,por,spa', 'Subtitle languages to keep'), input('tagLanguage', 'eng', 'Language for subtitles without one')], body: String.raw`
  var keep = splitList(args.inputs.languages);
  active(args).filter(isSubtitle).forEach(function (s) {
    var language = s.tags && s.tags.language ? s.tags.language.toLowerCase() : undefined;
    var title = s.tags && s.tags.title ? s.tags.title.toLowerCase() : '';
    if ((language !== undefined && !keep.includes(language)) || /commentary|description|sdh/.test(title)) {
      s.removed = true;
      return;
    }
    if (language === undefined) {
      s.tags = Object.assign({}, s.tags, { language: args.inputs.tagLanguage });
      s.outputArgs.push('-metadata:s:s:{outputTypeIndex}', 'language=' + args.inputs.tagLanguage);
    }
  });` },

keepNativeLanguages: { name: 'FK: Keep Native Languages', desc: 'Same rule as Keep_Native_Lang_Plus_Eng: native language from Radarr/Sonarr/TMDB, plus user languages, eng and und.', async: true,
  inputs: [input('priority', 'sonarr', 'radarr or sonarr'), input('user_langs', 'por', 'Extra audio languages'), input('api_key', '', 'TMDB v3 key'), input('radarr_api_key', '', 'Radarr key'), input('radarr_url', 'http://radarr:7878', 'Radarr url'), input('sonarr_api_key', '', 'Sonarr key'), input('sonarr_url', 'http://sonarr:8989', 'Sonarr url')],
  helpers: String.raw`
var REQUEST_TIMEOUT_MS = 15000;
var getJson = function (url) { return new Promise(function (resolve, reject) {
  var lib = url.startsWith('https') ? require('https') : require('http');
  var req = lib.get(url, { headers: { Accept: 'application/json' } }, function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
      try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, data: null }); }
    });
  });
  req.setTimeout(REQUEST_TIMEOUT_MS, function () { req.destroy(new Error('timeout')); });
  req.on('error', reject);
}); };
var parseArr = function (baseUrl, apiKey, name, log) {
  return getJson(baseUrl + '/api/v3/parse?apikey=' + apiKey + '&title=' + name)
    .then(function (res) { return res.status === 200 ? res.data : null; })
    .catch(function (e) { log('Could not reach ' + baseUrl + ': ' + e.message); return null; });
};
var fromRadarr = async function (inputs, name, log) {
  if (!inputs.radarr_api_key) return null;
  var body = await parseArr(inputs.radarr_url, inputs.radarr_api_key, name, log);
  var language = body && body.movie && body.movie.originalLanguage && body.movie.originalLanguage.name;
  return language ? require('@cospired/i18n-iso-languages').getAlpha2Code(language, 'en') : null;
};
var fromSonarr = async function (inputs, name, log) {
  if (!inputs.sonarr_api_key || !inputs.api_key) return null;
  var body = await parseArr(inputs.sonarr_url, inputs.sonarr_api_key, name, log);
  var imdbId = body && body.series && body.series.imdbId;
  if (!imdbId) return null;
  var res = await getJson('https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + inputs.api_key + '&language=en-US&external_source=imdb_id')
    .catch(function (e) { log('TMDB error: ' + e.message); return null; });
  var data = res && res.status === 200 ? res.data : null;
  var match = data && ((data.movie_results || [])[0] || (data.tv_results || [])[0]);
  return match ? match.original_language : null;
};`, body: String.raw`
  await args.installClassicPluginDeps(['@cospired/i18n-iso-languages@4.2.0']);
  var name = encodeURIComponent(args.inputFileObj.meta.FileName);
  var order = String(args.inputs.priority).toLowerCase() === 'sonarr' ? [fromSonarr, fromRadarr] : [fromRadarr, fromSonarr];
  var original = (await order[0](args.inputs, name, args.jobLog)) || (await order[1](args.inputs, name, args.jobLog));
  var alpha2 = original === 'cn' ? 'zh' : original;
  var alpha3 = alpha2 ? require('@cospired/i18n-iso-languages').alpha2ToAlpha3B(alpha2) : undefined;
  if (!alpha3) {
    args.jobLog('Could not resolve the native language. Keeping all audio tracks.');
    return next(args);
  }
  var keep = [alpha3].concat(splitList(args.inputs.user_langs).map(function (l) { return l.toLowerCase(); }), ['eng', 'und']);
  args.jobLog('Keeping languages: ' + keep.join(', '));
  var audio = active(args).filter(isAudio);
  var unwanted = audio.filter(function (s) { return s.tags && s.tags.language && !keep.includes(s.tags.language); });
  if (unwanted.length < audio.length) markRemoved(unwanted);` },

smartAudioCleanup: { name: 'FK: Smart Audio Cleanup', desc: 'Same rules as Smart_Remove_Commentaries_and_Duplicates.', inputs: [], helpers: String.raw`
var COMMENTARY_REGEX = /(^|[^\p{L}])(commentar(y|ies)|coment[aá]rios?|commento)([^\p{L}]|$)/iu;
var STEREO_MIX_REGEX = /(^|[^0-9.])(2\.0|1\.0)([^0-9]|$)|stereo|est[eé]reo|mono|downmix/i;
var shouldRemove = function (s, group) {
  var title = ((s.tags && s.tags.title) || '').toLowerCase();
  var channels = s.channels || 0;
  if ((s.disposition && s.disposition.comment === 1) || COMMENTARY_REGEX.test(title)) return true;
  if (group.length === 1) return false;
  var maxChannels = Math.max.apply(null, group.map(function (g) { return g.channels || 0; }));
  var isDefault = s.disposition && s.disposition.default === 1;
  if (maxChannels > 2 && channels <= 2 && !isDefault && !STEREO_MIX_REGEX.test(title)) return true;
  var isLegitDownmix = codecOf(s) === 'aac' || title.includes('2.0') || title.includes('stereo');
  return !(channels === maxChannels || channels >= 6 || isLegitDownmix);
};`, body: String.raw`
  var groups = {};
  var langOf = function (s) { return (s.tags && s.tags.language) || 'und'; };
  active(args).filter(isAudio).forEach(function (s) { groups[langOf(s)] = (groups[langOf(s)] || []).concat([s]); });
  var ordered = Object.keys(groups).reduce(function (all, lang) { return all.concat(groups[lang]); }, []);
  var unwanted = ordered.filter(function (s) { return shouldRemove(s, groups[langOf(s)]); });
  var kept = ordered.filter(function (s) { return !unwanted.includes(s); });
  if (unwanted.length === 0 || kept.length === 0) return next(args);
  markRemoved(unwanted);
  // Like the classic plugin: data streams go, and the first kept track becomes the only default.
  markRemoved(active(args).filter(ofType('data')));
  kept.forEach(function (s, index) {
    s.disposition = index === 0 ? { default: 1 } : {};
    s.outputArgs.push('-disposition:a:{outputTypeIndex}', index === 0 ? 'default' : '0');
  });` },

removeAttachments: { name: 'FK: Remove Attachments', desc: 'Removes attachment streams (fonts, cover art).', inputs: [], body: String.raw`
  markRemoved(active(args).filter(ofType('attachment')));` },

convertAudio: { name: 'FK: Convert Audio', desc: 'Same rules as Convert_Audio with aac_stereo + downmix: mono/stereo to AAC, 2.0 AAC downmix per surround track when the language has no 2.0.',
  inputs: [input('aacBitrate', '192k', 'Stereo AAC bitrate; mono uses half')], body: String.raw`
  var bitrate = /^\d+k$/.test(args.inputs.aacBitrate) ? args.inputs.aacBitrate : '192k';
  var audio = active(args).filter(isAudio);
  var langOf = function (s) { return ((s.tags && s.tags.language) || 'und').toLowerCase(); };
  var hasStereo = function (lang) { return audio.some(function (s) { return langOf(s) === lang && s.channels === 2; }); };
  var downmixes = audio.filter(function (s) { return s.channels > 2 && !hasStereo(langOf(s)); }).map(function (s) {
    var language = (s.tags && s.tags.language) || '';
    return Object.assign({}, s, {
      // Execute finds a stream's output position by index, so a copy can't share the source's.
      index: s.index + 1000,
      codec_name: 'aac',
      codec_long_name: 'AAC (Advanced Audio Coding)',
      channels: 2,
      tags: Object.assign({}, s.tags, { title: '2.0' }),
      mapArgs: s.mapArgs.slice(),
      inputArgs: [],
      outputArgs: ['-c:a:{outputTypeIndex}', 'aac', '-ac:a:{outputTypeIndex}', '2', '-b:a:{outputTypeIndex}', bitrate,
        '-metadata:s:a:{outputTypeIndex}', 'title=2.0'].concat(language ? ['-metadata:s:a:{outputTypeIndex}', 'language=' + language] : []),
    });
  });
  audio.filter(function (s) { return s.codec_name !== 'aac' && (s.channels === 1 || s.channels === 2); }).forEach(function (s) {
    var rate = s.channels === 1 ? Math.round(parseInt(bitrate, 10) / 2) + 'k' : bitrate;
    s.codec_name = 'aac';
    s.outputArgs.push('-c:a:{outputTypeIndex}', 'aac', '-b:a:{outputTypeIndex}', rate);
  });
  args.variables.ffmpegCommand.streams = args.variables.ffmpegCommand.streams.concat(downmixes);` },

removeByChannelCount: { name: 'FK: Remove Audio By Channels', desc: 'Same rule as remove_audio_by_channel_count.',
  inputs: [input('channelCounts', '3,6,7,8', 'Channel counts to remove')], body: String.raw`
  var counts = splitList(args.inputs.channelCounts).map(function (c) { return parseInt(c, 10); });
  var audio = active(args).filter(isAudio);
  var unwanted = audio.filter(function (s) { return counts.includes(s.channels); });
  if (audio.length > 1 && unwanted.length < audio.length) markRemoved(unwanted);` },

extractSubtitles: { name: 'FK: Extract Subtitles', desc: 'Same naming as Subtitles_Extractor. Adds SRT outputs to the single ffmpeg run and removes every embedded subtitle.',
  inputs: [input('codecs', 'subrip,ass,ssa,text,mov_text,webvtt', 'Subtitle codecs extracted to SRT')], helpers: String.raw`
var sidecarPath = function (s, libraryFile, used) {
  var title = ((s.tags && s.tags.title) || 'none').toLowerCase();
  var lang = (s.tags && s.tags.language) || 'und';
  if (lang.toLowerCase() === 'por' || lang.toLowerCase() === 'pt') {
    lang = title.includes('brazilian') || title.includes('br') ? 'pt-BR' : 'pt';
  }
  var type = s.disposition && s.disposition.hearing_impaired ? '.sdh' : '';
  if ((s.disposition && s.disposition.forced) || title.includes('forced') || title.includes('forçad')) type += '.forced';
  if (used.has(lang + type)) type += '.' + s.index;
  used.add(lang + type);
  var parts = libraryFile.split('.');
  parts[parts.length - 2] += '.' + lang + type;
  parts[parts.length - 1] = 'srt';
  return parts.join('.');
};`, body: String.raw`
  var fs = require('fs');
  var codecs = splitList(args.inputs.codecs).map(function (c) { return c.toLowerCase(); });
  var targets = active(args).filter(function (s) { return codecs.includes(codecOf(s)); });
  if (targets.length === 0) return next(args);
  var used = new Set();
  var sidecars = targets.map(function (s) { return { stream: s, path: sidecarPath(s, args.originalLibraryFile._id, used) }; });
  var isDescriptive = function (s) { return /commentary|description/.test(((s.tags && s.tags.title) || '').toLowerCase()); };
  args.variables.fkSubtitleOutputs = sidecars
    .filter(function (c) { return !fs.existsSync(c.path) && !isDescriptive(c.stream); })
    .map(function (c) { return { index: c.stream.index, path: c.path }; });
  args.variables.fkSidecars = sidecars.map(function (c) { return c.path; });
  markRemoved(active(args).filter(isSubtitle));` },

removeUnwantedCodecs: { name: 'FK: Remove Unwanted Codecs', desc: 'Same rule as MichPasCleanSubsAndAudioCodecs.',
  inputs: [input('subtitleCodecs', 'hdmv_pgs_subtitle,dvd_subtitle,dvd_sub,ass,ssa,webvtt,subviewer,microdvd,mov_text,ttml,eia_608,cea_708', 'Subtitle codecs to remove'),
    input('audioCodecs', 'mp3,ac3,eac3,dts,dtshd,opus,vorbis,wmav2,fl3c,flac,alac,pcm_s16le,pcm_s24le,pcm_s32le,truehd,ape,wavpack', 'Audio codecs to remove')], body: String.raw`
  var audioCodecs = splitList(args.inputs.audioCodecs);
  var subtitleCodecs = splitList(args.inputs.subtitleCodecs);
  markRemoved(active(args).filter(function (s) {
    return (isAudio(s) && audioCodecs.includes(codecOf(s))) || (isSubtitle(s) && subtitleCodecs.includes(codecOf(s)));
  }));` },

ensureAudio: { name: 'FK: Ensure Audio', desc: 'Same guard as Ensure_Audio, before any write: errors the job if every audio track would be lost.', inputs: [], body: String.raw`
  var original = args.originalLibraryFile.ffProbeData.streams.filter(isAudio).length;
  var kept = active(args).filter(isAudio).length;
  if (original > 0 && kept === 0) {
    throw new Error('All audio streams would be removed (original had ' + original + '). Aborting so the original file is not replaced.');
  }
  args.jobLog('Audio streams: ' + kept + ' (original had ' + original + ')');` },

reorderStreams: { name: 'FK: Reorder Streams', desc: 'Same order as re_order_all_streams_v2.',
  inputs: [input('languages', 'por,eng,spa', 'Language order'), input('channels', '2,1,5.1,7.1', 'Channel order'), input('codecs', 'aac', 'Codec order')], helpers: String.raw`
var CHANNELS = { 8: '7.1', 6: '5.1', 2: '2', 1: '1' };
var isImage = function (s) { return (s.codec_long_name || '').includes('image') || (s.codec_name || '').includes('png'); };
var sortBy = function (streams, wanted, getValue) {
  return wanted.slice().reverse().reduce(function (sorted, value) {
    var matches = sorted.filter(function (s) { return String(getValue(s)) === value && !isImage(s); });
    return matches.concat(sorted.filter(function (s) { return !matches.includes(s); }));
  }, streams);
};`, body: String.raw`
  var command = args.variables.ffmpegCommand;
  var kept = active(args);
  var sorted = sortBy(kept, splitList(args.inputs.codecs), function (s) { return s.codec_name; });
  sorted = sortBy(sorted, splitList(args.inputs.channels), function (s) { return CHANNELS[s.channels] || ''; });
  sorted = sortBy(sorted, splitList(args.inputs.languages), function (s) { return s.tags && s.tags.language !== undefined ? s.tags.language : ''; });
  sorted = sortBy(sorted, ['video', 'audio', 'subtitle'], function (s) { return s.codec_type; });
  if (sorted.some(function (s, i) { return s !== kept[i]; })) command.shouldProcess = true;
  command.streams = sorted.concat(command.streams.filter(function (s) { return s.removed; }));` },

conformMkv: { name: 'FK: Conform To MKV', desc: 'Same rules as Remux with force_conform: mkv container, no incompatible codecs, no data streams, genpts for legacy containers.', inputs: [], body: String.raw`
  var command = args.variables.ffmpegCommand;
  var incompatible = active(args).filter(function (s) { return ['mov_text', 'eia_608', 'timed_id3'].includes(codecOf(s)); });
  var source = String(command.container).toLowerCase();
  if (source === 'mkv' && incompatible.length === 0) return next(args);
  markRemoved(incompatible.concat(active(args).filter(ofType('data'))));
  if (source !== 'mkv') command.shouldProcess = true;
  if (['ts', 'avi', 'mpg', 'mpeg', 'vob'].includes(source)) command.overallInputArguments.push('-fflags', '+genpts');
  command.container = 'mkv';` },

hdrToSdr: { name: 'FK: HDR To SDR', desc: 'Same as HDR_to_SDR, on the single ffmpeg run: tonemap_cuda BT.2390 with Dolby Vision RPU, 10-bit HEVC NVENC.',
  inputs: [input('cq', '19', 'NVENC CQ'), input('max_bitrate_1080p', '12000', 'kbps'), input('max_bitrate_4KUHD', '40000', 'kbps'), input('downscale_4k_to_1080p', 'true', 'true or false')],
  helpers: VIDEO_HELPERS + String.raw`
var HDR_TRANSFERS = ['smpte2084', 'arib-std-b67'];
var HW_DECODE = { hevc: ['yuv420p', 'yuv420p10le', 'p010le'], vp9: ['yuv420p', 'yuv420p10le', 'p010le'], h264: ['yuv420p', 'yuvj420p'] };
var isDovi = function (s) { return (s.side_data_list || []).some(function (sd) { return /dovi|dolby vision/i.test(sd.side_data_type || ''); }); };`, body: String.raw`
  var video = mainVideo(args);
  if (!video || (!HDR_TRANSFERS.includes(video.color_transfer) && !isDovi(video))) return next(args);
  var is4k = (video.width || 0) >= 3200 || (video.height || 0) >= 1800;
  var downscale = is4k && String(args.inputs.downscale_4k_to_1080p) === 'true';
  var configured = Number(is4k && !downscale ? args.inputs.max_bitrate_4KUHD : args.inputs.max_bitrate_1080p);
  var kbps = videoKbps(args, video);
  var maxrate = kbps ? Math.max(2000, Math.min(configured, Math.round(kbps))) : configured;
  var hwDecode = (HW_DECODE[video.codec_name] || []).includes(video.pix_fmt);
  var tonemap = 'tonemap_cuda=tonemap=bt2390:peak=100:desat=0:format=p010:apply_dovi=1:transfer=bt709:matrix=bt709:primaries=bt709:range=tv'
    + (downscale ? ',scale_cuda=w=1920:h=-2:interp_algo=lanczos' : '');
  var filters = hwDecode ? tonemap : 'format=p010le,hwupload_cuda,' + tonemap;
  addVideoEncode(args, video, hwDecode, filters, [
    '-rc', 'vbr', '-cq', String(args.inputs.cq), '-b:v', '0', '-maxrate', maxrate + 'k', '-bufsize', (maxrate * 2) + 'k',
    '-rc-lookahead', '32', '-spatial-aq', '1', '-aq-strength', '8', '-surfaces', '64', '-bf', '0',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
  ]);
  args.variables.fkVideoEncoded = true;
  args.jobLog('HDR to SDR, maxrate ' + maxrate + ' kbps');` },

nvencEncode: { name: 'FK: NVENC Encode', desc: 'Same decisions as H264_HEVC_to_NVENC_MKV, on the single ffmpeg run. The video bitrate is the file bitrate minus its audio.', inputs: [],
  helpers: VIDEO_HELPERS + String.raw`
var MODERN = ['hevc', 'vp9', 'av1'];
var INTERLACED = ['tt', 'bb', 'tb', 'bt'];
var F420 = ['yuv420p', 'yuvj420p', 'nv12'];
var F10 = ['yuv420p10le', 'p010le'];
var HW_DECODE = { h264: F420, hevc: F420.concat(F10), vp9: F420.concat(F10), mpeg2video: F420, vc1: F420 };
var tierOf = function (s) {
  var w = s.width || 0; var h = s.height || 0;
  if (w >= 3200 || h >= 1800) return { name: '4KUHD', cap: 24000, cq: 20, filter: 35000 };
  if (w >= 2200 || h >= 1300) return { name: '1440p', cap: 27000, cq: 19, filter: 39600 };
  if (w >= 1700 || h >= 900) return { name: '1080p', cap: 15000, cq: 19, filter: 22000 };
  if (w >= 1100 || h >= 650) return { name: '720p', cap: 4000, cq: 20, filter: 6000 };
  return { name: 'SD', cap: 2000, cq: 19, filter: 3000 };
};
var isDovi = function (s) { return (s.side_data_list || []).some(function (sd) { return String(sd.side_data_type || '').toLowerCase().includes('dovi'); }); };
var isHdr = function (s) { return ['smpte2084', 'arib-std-b67'].includes(s.color_transfer) || s.color_primaries === 'bt2020'; };`, body: String.raw`
  if (args.variables.fkVideoEncoded) return next(args);
  var alreadyDone = args.inputFileObj.ffProbeData.streams.some(function (s) { return s.tags && s.tags.COPYRIGHT === 'processed'; });
  var video = mainVideo(args);
  if (alreadyDone || !video || isDovi(video) || isHdr(video)) return next(args);
  var source = tierOf(video);
  var downscale = source.name === '4KUHD';
  var tier = downscale ? tierOf({ width: 1920, height: 1080 }) : source;
  var kbps = videoKbps(args, video);
  args.jobLog('Video ' + video.codec_name + ' ' + video.width + 'x' + video.height + ', estimated ' + Math.round(kbps || 0) + ' kbps');
  if (MODERN.includes(video.codec_name) && !downscale && (!kbps || kbps <= tier.filter)) return next(args);
  var interlaced = INTERLACED.includes(video.field_order);
  if (video.codec_name === 'h264' && !downscale && !interlaced && kbps && kbps <= tier.cap) return next(args);
  var maxrate = Math.max(500, Math.min(tier.cap, kbps ? Math.round(kbps * 0.85) : Infinity));
  var hwDecode = (HW_DECODE[video.codec_name] || []).includes(video.pix_fmt);
  var scale = downscale ? ['scale_cuda=w=1920:h=-2:interp_algo=lanczos'] : [];
  var filters = (hwDecode
    ? (interlaced ? ['bwdif_cuda=0:-1:1'] : []).concat(['scale_cuda=format=p010le'], scale)
    : (interlaced ? ['bwdif=0:-1:1'] : []).concat(['format=p010le', 'hwupload_cuda'], scale)).join(',');
  addVideoEncode(args, video, hwDecode, filters, [
    '-rc', 'vbr', '-cq', String(tier.cq), '-b:v', '0', '-maxrate', maxrate + 'k', '-bufsize', (maxrate * 2) + 'k', '-tier', 'high',
    '-rc-lookahead', '32', '-spatial-aq', '1', '-aq-strength', '8', '-surfaces', '64', '-bf', '0',
  ]);
  args.jobLog('NVENC CQ ' + tier.cq + ', maxrate ' + maxrate + ' kbps');` },

processarArquivo: { name: 'Processar Arquivo', desc: 'Runs the native ffmpegCommandExecute and shows what this single pass does on the worker card.', async: true, inputs: [], body: String.raw`
  var command = args.variables.ffmpegCommand;
  var encodes = command.streams.some(function (s) { return s.outputArgs.includes('hevc_nvenc'); });
  var label = args.variables.fkVideoEncoded ? 'Limpeza + HDR para SDR' : (encodes ? 'Limpeza + Encode NVENC' : 'Limpeza de Faixas');
  if (command.shouldProcess) args.updateWorker({ status: label });
  args.jobLog('Passada unica: ' + label);
  return require('../../../../CommunityFlowPlugins/ffmpegCommand/ffmpegCommandExecute/1.0.0/index.js').plugin(args);` },

prepareExecute: { name: 'FK: Prepare Single Pass', desc: 'Puts the SRT outputs on the ffmpeg command and the mux options, only when there is work to do. Place right before Execute.', inputs: [], body: String.raw`
  var command = args.variables.ffmpegCommand;
  var kept = active(args);
  var outputs = args.variables.fkSubtitleOutputs || [];
  var hasWork = command.shouldProcess || outputs.length > 0
    || command.streams.some(function (s) { return s.removed || s.outputArgs.length > 0; });
  if (!hasWork) return next(args);
  // Execute writes the main file last, so the SRT outputs must come before the first -map of the main file.
  var extraOutputs = outputs.reduce(function (list, o) { return list.concat(['-map', '0:' + o.index, o.path]); }, []);
  kept[0].mapArgs = extraOutputs.concat(kept[0].mapArgs);
  command.shouldProcess = true;
  command.overallOuputArguments.push('-strict', '-2', '-max_muxing_queue_size', '9999');` },

cleanSubtitleTags: { name: 'FK: Clean Subtitle Tags', desc: 'Removes formatting tags from the extracted SRT files, as Subtitles_Extractor did.', noInit: true, inputs: [], body: String.raw`
  var fs = require('fs');
  (args.variables.fkSidecars || []).filter(function (p) { return fs.existsSync(p); }).forEach(function (p) {
    try {
      var content = fs.readFileSync(p, 'utf8');
      var cleaned = content.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '');
      if (cleaned !== content) fs.writeFileSync(p, cleaned, 'utf8');
    } catch (err) {
      args.jobLog('Error removing tags from ' + p + ': ' + err.message);
    }
  });` },

keepOriginalDate: { name: 'FK: Keep Original Date', desc: 'Same as keep_original_date: restores the mtime of the original file. Place after Replace Original File.', noInit: true, async: true, inputs: [], body: String.raw`
  var stat = args.originalLibraryFile.statSync;
  if (stat && stat.mtimeMs) {
    try {
      var when = new Date(stat.mtimeMs);
      await require('fs').promises.utimes(args.inputFileObj._id, when, when);
    } catch (err) {
      args.jobLog('Could not restore the file date: ' + err.message);
    }
  }` },
};

const LABELS = {
  removeImages: ['video', 'Vídeo: Remover Capas e Imagens'],
  hdrToSdr: ['video', 'Vídeo: HDR para SDR'],
  nvencEncode: ['video', 'Vídeo: Encode NVENC'],
  keepNativeLanguages: ['audio', 'Áudio: Manter Idiomas'],
  smartAudioCleanup: ['audio', 'Áudio: Remover Comentários e Duplicatas'],
  convertAudio: ['audio', 'Áudio: Converter para AAC'],
  removeByChannelCount: ['audio', 'Áudio: Remover Surround'],
  ensureAudio: ['audio', 'Áudio: Garantir que Restou Áudio'],
  cleanSubtitles: ['legendas', 'Legendas: Limpar Faixas'],
  extractSubtitles: ['legendas', 'Legendas: Extrair para SRT'],
  cleanSubtitleTags: ['legendas', 'Legendas: Limpar Formatação do SRT'],
  removeAttachments: ['faixas', 'Faixas: Remover Anexos'],
  removeUnwantedCodecs: ['faixas', 'Faixas: Remover Codecs Indesejados'],
  reorderStreams: ['faixas', 'Faixas: Ordenar'],
  conformMkv: ['arquivo', 'Arquivo: Converter para MKV'],
  prepareExecute: ['arquivo', 'Arquivo: Preparar Passada Única'],
  keepOriginalDate: ['arquivo', 'Arquivo: Manter Data Original'],
  processarArquivo: ['arquivo', 'Arquivo: Processar (Passada Única)'],
};

Object.entries(plugins).forEach(([id, p]) => {
  const [category, label] = LABELS[id];
  const dir = path.join(root, category, id, '1.0.0');
  fs.mkdirSync(dir, { recursive: true });
  const details = JSON.stringify({
    name: label, description: p.desc, style: { borderColor: '#6efefc' }, tags: 'video', isStartPlugin: false, pType: '',
    requiresVersion: '2.11.01', sidebarPosition: -1, icon: '', inputs: p.inputs, outputs: [{ number: 1, tooltip: 'Continue to next plugin' }],
  }, null, 2);
  const src = `${PRELUDE}${p.helpers || ''}
var details = function () { return (${details}); };
exports.details = details;
var plugin = ${p.async ? 'async ' : ''}function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);${p.noInit ? '' : '\n  flowUtils_1.checkFfmpegCommandInit(args);'}${p.body}
  return next(args);
};
exports.plugin = plugin;
`;
  fs.writeFileSync(path.join(dir, 'index.js'), src);
});
console.log(Object.keys(plugins).length, 'plugins written');
