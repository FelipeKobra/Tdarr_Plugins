// Differential test: real classic stack vs flow, on identical synthetic files. Runs inside the tdarr container.
// Usage: docker exec -i -e K=<api key> tdarr node - <setup|compare|teardown> < flow-test.js
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
const KEY = process.env.K;
const ROOT = '/data/tdarr-flowtest';
const BASE = 'The Matrix (1999) [imdbid-tt0133093]';
const LIBS = { classic: 'fkTestClassic', flow: 'fkTestFlow' };
const FLOW_ID = 'fkTestFlowDoc';

const api = async (route, data) => {
  const res = await fetch(`http://localhost:8266/api/v2/${route}`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return text; }
};
const cruddb = (collection, modeName, docID, obj) => api('cruddb', { collection, mode: modeName, docID, obj });

const A = (codec, ac, lang, title, def) => ({ codec, ac, lang, title, def });
const S = (lang, title, text) => ({ lang, title, text });
const CASES = {
  surroundCommentaryForeign: {
    audio: [A('eac3', 6, 'eng', 'Surround', 1), A('aac', 2, 'eng', '', 0), A('ac3', 2, 'por', 'Portuguese', 0), A('ac3', 6, 'fra', 'French', 0)],
    subs: [S('eng', 'English', '<i>hello</i> {\\an8}world'), S('por', 'Brazilian', 'ola'), S('fra', 'French', 'salut'), S('eng', 'English SDH', 'door creaks'), S('und', '', 'mystery'), S('spa', 'Commentary', 'x')],
    attach: true,
  },
  monoFlacWithCover: { audio: [A('flac', 1, 'eng', '', 1)], subs: [], cover: true },
  sevenOnePlusStereoTitle: { audio: [A('flac', 8, 'eng', '7.1 Master', 1), A('ac3', 2, 'eng', 'Stereo', 0)], subs: [S('por', 'Portuguese', 'a'), S('por', 'Portuguese Forced', 'b')] },
  blindStereoAc3: { audio: [A('eac3', 6, 'eng', '', 1), A('ac3', 2, 'eng', '', 0)], subs: [] },
  aacFiveOneAlone: { audio: [A('aac', 6, 'eng', '', 1)], subs: [] },
  twoSurroundLanguages: { audio: [A('eac3', 6, 'eng', 'A', 1), A('eac3', 6, 'por', 'B', 0)], subs: [S('eng', '', 'text')] },
  fiveZeroKept: { audio: [A('aac', 5, 'eng', '', 1), A('ac3', 6, 'eng', '', 0)], subs: [] },
  alreadyClean: { audio: [A('aac', 2, 'eng', '2.0', 1)], subs: [] },
  orderNeedsFix: { audio: [A('aac', 2, 'eng', '', 1), A('aac', 2, 'por', '', 0)], subs: [] },
  mpeg4NeedsEncode: { video: 'mpeg4', audio: [A('ac3', 6, 'eng', '', 1)], subs: [S('eng', '', 'text')] },
  hdrToneMap: { video: 'libx265', hdr: true, audio: [A('aac', 2, 'eng', '2.0', 1)], subs: [] },
  mp4Container: { ext: 'mp4', audio: [A('aac', 6, 'eng', '', 1), A('aac', 2, 'eng', 'Stereo', 0)], subs: [S('eng', '', 'mp4 text')] },
};

const buildFixture = (name, spec, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const ext = spec.ext || 'mkv';
  const out = path.join(dir, `${BASE} ${name}.${ext}`);
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-t', '4', '-i', 'testsrc2=size=640x360:rate=24'];
  const maps = ['-map', '0:v'];
  let next = 1;
  const codecArgs = ['-c:v', spec.video || 'libx264', '-b:v', '3M', '-pix_fmt', spec.hdr ? 'yuv420p10le' : 'yuv420p',
    ...(spec.hdr ? ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-x265-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc'] : [])];
  spec.audio.forEach((a, i) => {
    args.push('-f', 'lavfi', '-t', '4', '-i', `sine=frequency=${300 + i * 100}:sample_rate=48000`);
    maps.push('-map', `${next}:a`);
    next += 1;
    codecArgs.push(`-c:a:${i}`, a.codec, `-ac:a:${i}`, String(a.ac), `-metadata:s:a:${i}`, `language=${a.lang}`);
    if (a.codec === 'aac' || a.codec === 'ac3' || a.codec === 'eac3') codecArgs.push(`-b:a:${i}`, '256k');
    if (a.title) codecArgs.push(`-metadata:s:a:${i}`, `title=${a.title}`);
    codecArgs.push(`-disposition:a:${i}`, a.def ? 'default' : '0');
  });
  spec.subs.forEach((s, i) => {
    const file = path.join(dir, `in${i}.tmp`);
    fs.writeFileSync(file, `1\n00:00:00,000 --> 00:00:03,000\n${s.text}\n`);
    args.push('-f', 'srt', '-i', file);
    maps.push('-map', `${next}:s`);
    next += 1;
    codecArgs.push(`-metadata:s:s:${i}`, `language=${s.lang}`);
    if (s.title) codecArgs.push(`-metadata:s:s:${i}`, `title=${s.title}`);
  });
  codecArgs.push('-c:s', ext === 'mp4' ? 'mov_text' : 'srt');
  if (spec.cover) {
    args.push('-f', 'lavfi', '-i', 'color=red:size=64x64:duration=0.04');
    maps.push('-map', `${next}:v`);
    next += 1;
    codecArgs.push('-c:v:1', 'png', '-disposition:v:1', 'attached_pic');
  }
  if (spec.attach) {
    const font = path.join(dir, 'font.ttf');
    fs.writeFileSync(font, 'not really a font');
    codecArgs.push('-attach', font, '-metadata:s:t', 'mimetype=application/x-truetype-font');
  }
  const res = spawnSync('tdarr-ffmpeg', [...args, ...maps, ...codecArgs, out], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`fixture ${name}: ${res.stderr}`);
  fs.readdirSync(dir).filter((f) => f.endsWith('.tmp') || f === 'font.ttf').forEach((f) => fs.unlinkSync(path.join(dir, f)));
};

const node = (pluginName, sourceRepo, version, id, inputsDB) => ({
  name: pluginName, sourceRepo, pluginName, version, id, position: { x: 400, y: 80 * Number(id.slice(1)) }, inputsDB: inputsDB || {}, fpEnabled: true,
});

const G = (name) => `{{{args.userVariables.global.${name}}}}`;
const L = (name) => `{{{args.userVariables.library.${name}}}}`;
const VARIABLE_KEEP_INPUTS = {
  priority: L('arr_priority'), radarr_url: G('radarr_url'), radarr_api_key: G('radarr_api_key'),
  sonarr_url: G('sonarr_url'), sonarr_api_key: G('sonarr_api_key'), api_key: G('tmdb_api_key'),
};

const buildFlow = (id, name) => {
  const keepInputs = VARIABLE_KEEP_INPUTS;
  const chain = [
    ['inputFile', 'Community', '1.0.0', {}],
    ['checkFileMedium', 'Community', '1.0.0', {}],
    ['ffmpegCommandStart', 'Community', '1.0.0', {}],
    ['removeImages', 'Local', '1.0.0', {}],
    ['cleanSubtitles', 'Local', '1.0.0', {}],
    ['keepNativeLanguages', 'Local', '1.0.0', keepInputs],
    ['smartAudioCleanup', 'Local', '1.0.0', {}],
    ['removeAttachments', 'Local', '1.0.0', {}],
    ['convertAudio', 'Local', '1.0.0', {}],
    ['removeByChannelCount', 'Local', '1.0.0', {}],
    ['extractSubtitles', 'Local', '1.0.0', {}],
    ['removeUnwantedCodecs', 'Local', '1.0.0', {}],
    ['ensureAudio', 'Local', '1.0.0', {}],
    ['reorderStreams', 'Local', '1.0.0', {}],
    ['conformMkv', 'Local', '1.0.0', {}],
    ['hdrToSdr', 'Local', '1.0.0', {}],
    ['nvencEncode', 'Local', '1.0.0', {}],
    ['prepareExecute', 'Local', '1.0.0', {}],
    ['processarArquivo', 'Local', '1.0.0', {}],
    ['cleanSubtitleTags', 'Local', '1.0.0', {}],
    ['checkFileChanged', 'Community', '1.0.0', {}],
    ['compareFileSizeRatio', 'Community', '2.0.0', { greaterThan: '6', lessThan: '130' }],
    ['compareFileDurationRatio', 'Community', '1.0.0', {}],
    ['runHealthCheck', 'Community', '1.0.0', { type: 'thorough', gpuAcceleration: 'auto' }],
    ['replaceOriginalFile', 'Community', '1.0.0', {}],
    ['keepOriginalDate', 'Local', '1.0.0', {}],
    ['checkFlowVariable', 'Community', '1.0.0', { variable: L('arr'), condition: '==', value: 'radarr' }],
    ['notifyRadarrOrSonarr', 'Community', '3.0.0', { arr: 'radarr', arr_host: G('radarr_url'), arr_api_key: G('radarr_api_key') }],
  ];
  const COLUMN_SIZE = 9;
  const place = (i) => ({ x: 120 + 340 * Math.floor(i / COLUMN_SIZE), y: 60 + 110 * (i % COLUMN_SIZE) });
  const flowPlugins = chain.map(([name, repo, version, inputs], i) => ({ ...node(name, repo, version, `n${i}`, inputs), position: place(i) }));
  const edge = (source, handle, target) => ({ source, sourceHandle: String(handle), target, targetHandle: null, id: `${source}-${handle}-${target}` });
  const flowEdges = chain.slice(1).map((_, i) => edge(`n${i}`, 1, `n${i + 1}`));
  const sizeCheck = chain.findIndex((row) => row[0] === 'compareFileSizeRatio');
  const changedCheck = chain.findIndex((row) => row[0] === 'checkFileChanged');
  const arrCheck = chain.findIndex((row) => row[0] === 'checkFlowVariable');
  flowEdges.push(edge(`n${changedCheck}`, 2, `n${arrCheck}`));
  const failId = `n${chain.length}`;
  flowPlugins.push({ ...node('failFlow', 'Community', '1.0.0', failId, {}), position: { x: 120 + 340 * 3, y: 60 } });
  flowEdges.push(edge(`n${sizeCheck}`, 2, failId), edge(`n${sizeCheck + 1}`, 2, failId), edge(`n${sizeCheck + 1}`, 3, failId));
  const sonarrId = `n${chain.length + 1}`;
  flowPlugins.push({ ...node('notifyRadarrOrSonarr', 'Community', '3.0.0', sonarrId, { arr: 'sonarr', arr_host: G('sonarr_url'), arr_api_key: G('sonarr_api_key') }), position: { x: 120 + 340 * 3, y: 170 } });
  flowEdges.push(edge(`n${chain.length - 2}`, 2, sonarrId));
  return { _id: id, name, description: 'Stream cleanup in one ffmpeg pass, then HDR/NVENC. Per-library behaviour comes from library variables.', tags: '', flowPlugins, flowEdges };
};

const putVariable = async (existing, type, key, value) => {
  const found = existing.find((v) => v.type === type && v.key === key);
  if (found) await api('cruddb', { collection: 'VariablesJSONDB', mode: 'update', docID: found._id, obj: { _id: found._id, value, type } }).catch(() => null);
  else await api('cruddb', { collection: 'VariablesJSONDB', mode: 'insert', docID: `${type}.${key}`.replace(/[^a-zA-Z0-9]/g, '_'), obj: { key, value, type, date: Date.now() } }).catch(() => null);
};

const putGlobals = async (movies) => {
  const inputs = movies.pluginIDs.find((p) => p.id === 'Tdarr_Plugin_FelipeKbra_Keep_Native_Lang_Plus_Eng').InputsDB;
  const existing = await cruddb('VariablesJSONDB', 'getAll');
  const values = {
    radarr_url: 'http://radarr:7878', radarr_api_key: inputs.radarr_api_key,
    sonarr_url: 'http://sonarr:8989', sonarr_api_key: inputs.sonarr_api_key, tmdb_api_key: inputs.api_key,
  };
  for (const [key, value] of Object.entries(values)) await putVariable(existing, 'global', key, value);
};

const putLibraryVars = async (libraryId, arr) => {
  const existing = await cruddb('VariablesJSONDB', 'getAll');
  await putVariable(existing, `library:${libraryId}`, 'arr', arr);
  await putVariable(existing, `library:${libraryId}`, 'arr_priority', arr);
};

const setTestFlowSizeLimit = async (lessThan) => {
  const flows = await cruddb('FlowsJSONDB', 'getAll');
  const flow = flows.find((f) => f._id === FLOW_ID);
  const flowPlugins = flow.flowPlugins.map((p) => (p.pluginName === 'compareFileSizeRatio'
    ? { ...p, inputsDB: { ...p.inputsDB, lessThan } } : p));
  await api('cruddb', { collection: 'FlowsJSONDB', mode: 'update', docID: FLOW_ID, obj: { flowPlugins } }).catch(() => null);
};

const requeue = async (match) => {
  const rows = (await cruddb('FileJSONDB', 'getAll')).filter((f) => f.file?.startsWith(`${ROOT}/flow/`) && f.file.includes(match));
  for (const f of rows) {
    await api('cruddb', { collection: 'FileJSONDB', mode: 'update', docID: f._id, obj: { TranscodeDecisionMaker: 'Queued', bumped: Date.now() } }).catch(() => null);
  }
  return rows.length;
};

const fileState = (match) => {
  const dir = path.join(ROOT, 'flow', match);
  return fs.readdirSync(dir).map((f) => {
    const s = fs.statSync(path.join(dir, f));
    return `${f.replace(BASE, '')} ${s.size} ${Math.round(s.mtimeMs)}`;
  }).join(' | ');
};

const failtest = async () => {
  console.log('before', fileState('blindStereoAc3'));
  await setTestFlowSizeLimit('1');
  console.log('requeued', await requeue('blindStereoAc3'));
};
const realfail = async () => {
  const dir = path.join(ROOT, 'flow', 'blindStereoAc3');
  fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  buildFixture('blindStereoAc3', CASES.blindStereoAc3, dir);
  const owner = fs.statSync('/data/media/movies');
  execSync(`chown -R ${owner.uid}:${owner.gid} ${dir}`);
  await setTestFlowSizeLimit('1');
  const flow = (await cruddb('FlowsJSONDB', 'getAll')).find((f) => f._id === FLOW_ID);
  console.log('limit now', flow.flowPlugins.find((p) => p.pluginName === 'compareFileSizeRatio').inputsDB.lessThan);
  await api('scan-files', { scanConfig: { dbID: LIBS.flow, arrayOrPath: [path.join(dir, `${BASE} blindStereoAc3.mkv`)], mode: 'scanFolderWatcher' } }).catch(() => null);
  await new Promise((r) => setTimeout(r, 6000));
  console.log('before', fileState('blindStereoAc3'), '| requeued', await requeue('blindStereoAc3'));
};
const stabletest = async () => {
  await setTestFlowSizeLimit('130');
  console.log('before', fileState('twoSurroundLanguages'));
  console.log('requeued', await requeue('twoSurroundLanguages'));
};
const state = async () => {
  console.log('blind ', fileState('blindStereoAc3'));
  console.log('two   ', fileState('twoSurroundLanguages'));
  const rows = (await cruddb('FileJSONDB', 'getAll')).filter((f) => /flow\/(blindStereoAc3|twoSurroundLanguages)/.test(f.file || ''));
  console.log(rows.map((f) => `${path.basename(path.dirname(f.file))} ${f.TranscodeDecisionMaker}`).join('\n'));
};

const LIBRARIES = { osUXGslez: 'radarr', ct2vcWANM: 'sonarr', VxSmFY0sZ: 'sonarr' };
const PRODUCTION_FLOW_ID = 'fkStreamCleanup';
const install = async () => {
  const libs = await cruddb('LibrarySettingsJSONDB', 'getAll');
  await putGlobals(libs.find((l) => l.name === 'Movies'));
  const { _id: unusedId, ...flowFields } = buildFlow(PRODUCTION_FLOW_ID, 'Processar Mídia');
  await api('cruddb', { collection: 'FlowsJSONDB', mode: 'update', docID: PRODUCTION_FLOW_ID, obj: flowFields }).catch(() => null);
  for (const [id, arr] of Object.entries(LIBRARIES)) {
    await putLibraryVars(id, arr);
    const lib = libs.find((l) => l._id === id);
    await api('cruddb', { collection: 'LibrarySettingsJSONDB', mode: 'update', docID: id, obj: {
      flowId: PRODUCTION_FLOW_ID, processTranscodes: true,
      decisionMaker: { ...lib.decisionMaker, settingsPlugin: false, settingsVideo: false, settingsAudio: false, settingsFlows: true },
    } }).catch(() => null);
  }
  console.log('installed on', Object.keys(LIBRARIES).length, 'libraries');
};
const rollback = async () => {
  const libs = await cruddb('LibrarySettingsJSONDB', 'getAll');
  for (const id of Object.keys(LIBRARIES)) {
    const lib = libs.find((l) => l._id === id);
    await api('cruddb', { collection: 'LibrarySettingsJSONDB', mode: 'update', docID: id, obj: {
      decisionMaker: { ...lib.decisionMaker, settingsPlugin: true, settingsFlows: false },
    } }).catch(() => null);
  }
  console.log('classic stack restored');
};

const setup = async () => {
  Object.entries(CASES).forEach(([name, spec]) => {
    ['classic', 'flow'].forEach((side) => buildFixture(name, spec, path.join(ROOT, side, name)));
  });
  const owner = fs.statSync('/data/media/movies');
  execSync(`chown -R ${owner.uid}:${owner.gid} ${ROOT}`);
  const libs = await cruddb('LibrarySettingsJSONDB', 'getAll');
  const movies = libs.find((l) => l.name === 'Movies');
  await putGlobals(movies);
  await putLibraryVars(LIBS.flow, 'radarr');
  await cruddb('FlowsJSONDB', 'insert', FLOW_ID, buildFlow(FLOW_ID, 'FK Test Single Pass'));
  for (const [side, id] of Object.entries(LIBS)) {
    const { _id, createdAt, ...rest } = JSON.parse(JSON.stringify(movies));
    const lib = {
      ...rest, name: id, folder: path.join(ROOT, side), cache: movies.cache, priority: 1000, processTranscodes: true,
      folderWatching: false, scanOnStart: false, scheduledScanFindNew: false, processHealthChecks: false,
      decisionMaker: { ...movies.decisionMaker, settingsPlugin: side !== 'flow', settingsFlows: side === 'flow' },
      flowId: side === 'flow' ? FLOW_ID : '',
    };
    await cruddb('LibrarySettingsJSONDB', 'insert', id, lib);
    await api('scan-files', { scanConfig: { dbID: id, arrayOrPath: lib.folder, mode: 'scanFindNew' } });
  }
  const expected = Object.keys(CASES).length * 2;
  const wanted = async () => (await cruddb('FileJSONDB', 'getAll')).filter((f) => f.file?.startsWith(ROOT));
  for (let i = 0; i < 40 && (await wanted()).length < expected; i += 1) await new Promise((r) => setTimeout(r, 3000));
  const rows = await wanted();
  await Promise.all(rows.map((f) => api('cruddb', { collection: 'FileJSONDB', mode: 'update', docID: f._id, obj: { bumped: Date.now() } }).catch(() => null)));
  console.log('setup done', rows.length, 'files bumped of', expected);
};

const probe = (file) => {
  const res = spawnSync('tdarr-ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  if (res.status !== 0) { const r2 = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }); return JSON.parse(r2.stdout).streams; }
  return JSON.parse(res.stdout).streams;
};
const shape = (s) => [s.codec_type, s.codec_name, s.channels || '', s.tags?.language || '', s.tags?.title || '', s.disposition?.default ? 'def' : '', s.color_transfer || ''].join('|');

const summarize = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.partial.old'));
  const video = files.filter((f) => /\.(mkv|mp4)$/.test(f));
  const srt = files.filter((f) => f.endsWith('.srt')).sort();
  return {
    video: video.map((f) => path.extname(f)),
    streams: video.flatMap((f) => probe(path.join(dir, f)).map(shape)),
    srt: srt.map((f) => `${f.replace(BASE, '')}: ${fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(2).join(' ').trim()}`),
  };
};

const compare = async () => {
  let same = 0;
  Object.keys(CASES).forEach((name) => {
    const a = JSON.stringify(summarize(path.join(ROOT, 'classic', name)), null, 1);
    const b = JSON.stringify(summarize(path.join(ROOT, 'flow', name)), null, 1);
    if (a === b) { same += 1; console.log('SAME', name); } else console.log('DIFF', name, '\n classic', a, '\n flow', b);
  });
  console.log(`${same}/${Object.keys(CASES).length} identical`);
  const all = await cruddb('FileJSONDB', 'getAll');
  const rows = Array.isArray(all) ? all.filter((f) => f.file?.startsWith(ROOT)) : [];
  console.log(rows.map((f) => `${f.file.includes('/flow/') ? 'F' : 'C'} ${path.basename(path.dirname(f.file))} ${f.TranscodeDecisionMaker}`).sort().join('\n'));
};

const teardown = async () => {
  await Promise.all(Object.values(LIBS).map((id) => cruddb('LibrarySettingsJSONDB', 'removeOne', id)));
  await cruddb('FlowsJSONDB', 'removeOne', FLOW_ID);
  const variables = await cruddb('VariablesJSONDB', 'getAll');
  await Promise.all(variables.filter((v) => v.type === `library:${LIBS.flow}`).map((v) => cruddb('VariablesJSONDB', 'removeOne', v._id)));
  const all = await cruddb('FileJSONDB', 'getAll');
  const rows = Array.isArray(all) ? all.filter((f) => f.file?.startsWith(ROOT)) : [];
  await Promise.all(rows.map((f) => cruddb('FileJSONDB', 'removeOne', f._id)));
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log('teardown done,', rows.length, 'file rows removed');
};

if (mode !== 'hdrcase') ({ setup, compare, teardown, realfail, failtest, stabletest, state, install, rollback })[mode]().catch((err) => { console.error(err); process.exit(1); });

if (mode === 'hdrcase') {
  (async () => {
    const dir = path.join(ROOT, 'flow', 'hdrToneMap');
    fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    buildFixture('hdrToneMap', CASES.hdrToneMap, dir);
    const owner = fs.statSync('/data/media/movies');
    execSync(`chown -R ${owner.uid}:${owner.gid} ${dir}`);
    const file = path.join(dir, `${BASE} hdrToneMap.mkv`);
    console.log('before', probe(file).map(shape).join(' ; '));
    await api('scan-files', { scanConfig: { dbID: LIBS.flow, arrayOrPath: [file], mode: 'scanFolderWatcher' } }).catch(() => null);
    await new Promise((r) => setTimeout(r, 8000));
    console.log('requeued', await requeue('hdrToneMap'));
    for (let i = 0; i < 24; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      const row = (await cruddb('FileJSONDB', 'getAll')).find((f) => f.file === file);
      if (row && !/Queued|Processing/.test(row.TranscodeDecisionMaker)) { console.log('status', row.TranscodeDecisionMaker); break; }
    }
    console.log('after ', probe(file).map(shape).join(' ; '));
  })().catch((e) => { console.error(e); process.exit(1); });
}
