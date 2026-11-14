"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var fs = require("fs");
var path = require("path");
var splitList = function (v) { return String(v).split(',').map(function (i) { return i.trim().toLowerCase(); }).filter(Boolean); };
// Each kept language also matches its 2-letter code and regional variants (pt-BR, es-419).
var ALIASES = { eng: ['en'], por: ['pt', 'pob', 'ptbr'], spa: ['es'], jpn: ['ja'], fre: ['fr', 'fra'], ger: ['de', 'deu'], ita: ['it'] };
var FLAGS = ['forced', 'sdh', 'cc', 'hi', 'default'];
var LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;

var details = function () { return ({
  "name": "Subtitles: Clean Sidecar Files",
  "description": "Deletes .srt files next to the video in languages that are not kept, such as the ones Radarr or Sonarr import with the release.\n\nFiles with no language code, with only a number, or in a kept language stay.",
  "style": {
    "borderColor": "#81c784"
  },
  "tags": "subtitle",
  "isStartPlugin": false,
  "pType": "",
  "requiresVersion": "2.11.01",
  "sidebarPosition": -1,
  "icon": "faClosedCaptioning",
  "inputs": [
    {
      "label": "Subtitle languages",
      "name": "languages",
      "type": "string",
      "defaultValue": "eng,por,spa",
      "inputUI": { "type": "text" },
      "tooltip": "Languages to keep, comma separated (3-letter codes)."
    }
  ],
  "outputs": [
    {
      "number": 1,
      "tooltip": "Continue to the next step"
    }
  ]
}); };
exports.details = details;

var keptCodes = function (languages) {
  return splitList(languages).reduce(function (all, lang) { return all.concat([lang], ALIASES[lang] || []); }, []);
};

// Language of a sidecar name, e.g. "movie.pt-BR.forced.srt" -> "pt-br"; empty when it has none.
var languageOf = function (base, file) {
  var tokens = file.slice(base.length + 1, -4).toLowerCase().split('.')
    .filter(function (t) { return t && !FLAGS.includes(t) && !/^\d+$/.test(t); });
  return tokens.length ? tokens[0] : '';
};

var plugin = function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);
  var video = args.originalLibraryFile._id;
  var dir = path.dirname(video);
  var base = path.basename(video, path.extname(video));
  var keep = keptCodes(args.inputs.languages);
  var removed = [];
  try {
    fs.readdirSync(dir).forEach(function (file) {
      if (!file.toLowerCase().endsWith('.srt') || !file.startsWith(base + '.')) return;
      var lang = languageOf(base, file);
      if (!lang || !LANGUAGE_CODE.test(lang)) return;
      if (keep.includes(lang) || keep.includes(lang.split('-')[0])) return;
      fs.unlinkSync(path.join(dir, file));
      removed.push(file.slice(base.length + 1));
    });
  } catch (err) {
    args.jobLog('☒ Could not clean sidecar subtitles: ' + err.message);
  }
  args.jobLog('── Subtitles: Clean Sidecar Files ──\n' + (removed.length
    ? removed.map(function (f) { return '☒ Removed: ' + f; }).join('\n')
    : '☑ Nothing to change'));
  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};
exports.plugin = plugin;
