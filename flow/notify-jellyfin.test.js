// Tests for the Notify Jellyfin flow node.
// Unit (mocked Jellyfin): docker exec tdarr node --test /app/server/Tdarr/Plugins/Local/flow/notify-jellyfin.test.js
// Live (real Jellyfin, only asks it to re-read one title): add -e J=<jellyfin key> -e LIVE_FILE=<path known to Jellyfin>
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const NODE = process.env.NODE_FILE
  || '/app/server/Tdarr/Plugins/FlowPlugins/LocalFlowPlugins/file/notifyJellyfin/1.0.0/index.js';
const KEY = 'a'.repeat(32);
const FILE = '/data/media/movies/Some Film (2001)/Some Film (2001).mkv';

// The node loads Tdarr helpers by relative path; give it minimal stand-ins.
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request.endsWith('methods/lib')) {
    return () => ({ loadDefaultValues: (inputs, details) => {
      const defaults = Object.fromEntries(details().inputs.map((i) => [i.name, i.defaultValue]));
      return { ...defaults, ...inputs };
    } });
  }
  if (request.endsWith('interfaces/flowUtils')) return { checkFfmpegCommandInit: () => {} };
  return realLoad.call(this, request, ...rest);
};
const { plugin, details } = require(NODE);

const fakeAxios = (answers) => {
  const calls = [];
  const axios = async (config) => {
    calls.push(config);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer || { status: 204, data: '' };
  };
  return { axios, calls };
};
const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
const netError = (code) => Object.assign(new Error(`connect ${code}`), { code });

const makeArgs = ({ inputs = {}, globals = {}, axios, file = FILE, report = false }) => {
  const logs = [];
  const args = {
    inputs,
    userVariables: { global: globals, library: {} },
    inputFileObj: { _id: file },
    originalLibraryFile: { _id: file },
    variables: report ? { ffmpegCommand: { init: true, streams: [] } } : {},
    deps: { axios },
    jobLog: (line) => logs.push(line),
  };
  return { args, logs };
};
const configured = { jellyfin_url: 'http://jellyfin:8096', jellyfin_api_key: KEY };
const listing = (items) => ({ status: 200, data: { Items: items } });

test('details expose the two settings with variable defaults', () => {
  const names = details().inputs.map((i) => [i.name, i.defaultValue]);
  assert.deepStrictEqual(names, [
    ['jellyfin_url', '{{{args.userVariables.global.jellyfin_url}}}'],
    ['jellyfin_api_key', '{{{args.userVariables.global.jellyfin_api_key}}}'],
  ]);
});

test('asks Jellyfin for a full re-read of the matching item', async () => {
  const { axios, calls } = fakeAxios([listing([{ Id: 'other', Path: '/data/media/x.mkv' }, { Id: 'abc123', Path: FILE }]), { status: 204 }]);
  const { args, logs } = makeArgs({ inputs: configured, axios });
  const out = await plugin(args);
  assert.strictEqual(out.outputNumber, 1);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].method, 'get');
  assert.match(calls[0].url, /^http:\/\/jellyfin:8096\/Items\?Recursive=true&IncludeItemTypes=Movie,Episode,Video&Fields=Path/);
  assert.strictEqual(calls[0].headers.Authorization, `MediaBrowser Token="${KEY}"`);
  assert.strictEqual(calls[1].method, 'post');
  assert.strictEqual(calls[1].url, 'http://jellyfin:8096/Items/abc123/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=Default&replaceAllMetadata=false&replaceAllImages=false');
  assert.ok(calls.every((c) => c.timeout > 0));
  assert.match(logs.join('\n'), /asked to re-read this file \(item abc123\)/);
});

test('skips the refresh when Jellyfin does not list the file yet', async () => {
  const { axios, calls } = fakeAxios([listing([{ Id: 'other', Path: '/data/media/x.mkv' }])]);
  const { args, logs } = makeArgs({ inputs: configured, axios });
  const out = await plugin(args);
  assert.strictEqual(out.outputNumber, 1);
  assert.strictEqual(calls.length, 1);
  assert.match(logs.join('\n'), /does not list this file yet/);
});

test('falls back to global variables when the inputs are unresolved templates', async () => {
  const { axios, calls } = fakeAxios([listing([{ Id: 'abc', Path: FILE }]), { status: 204 }]);
  const { args } = makeArgs({ globals: { jellyfin_url: 'http://jf:8096/', jellyfin_api_key: KEY }, axios });
  await plugin(args);
  assert.match(calls[0].url, /^http:\/\/jf:8096\/Items\?/);
  assert.strictEqual(calls[1].url.startsWith('http://jf:8096/Items/abc/Refresh?'), true);
});

test('does nothing and says so when not configured', async () => {
  const { axios, calls } = fakeAxios([]);
  const { args, logs } = makeArgs({ axios });
  const out = await plugin(args);
  assert.strictEqual(out.outputNumber, 1);
  assert.strictEqual(calls.length, 0);
  assert.match(logs.join('\n'), /variable is empty/);
});

test('a rejected key never stops the flow and never shows the key', async () => {
  const { axios } = fakeAxios([httpError(401)]);
  const { args, logs } = makeArgs({ inputs: configured, axios });
  const out = await plugin(args);
  assert.strictEqual(out.outputNumber, 1);
  assert.match(logs.join('\n'), /Could not tell Jellyfin \(HTTP 401\)/);
  assert.ok(!logs.join('\n').includes(KEY));
});

test('Jellyfin offline never stops the flow', async () => {
  const { axios } = fakeAxios([netError('ECONNREFUSED')]);
  const { args, logs } = makeArgs({ inputs: configured, axios });
  const out = await plugin(args);
  assert.strictEqual(out.outputNumber, 1);
  assert.match(logs.join('\n'), /Could not tell Jellyfin \(ECONNREFUSED\)/);
});

test('a failed refresh after a match is reported', async () => {
  const { axios } = fakeAxios([listing([{ Id: 'abc', Path: FILE }]), httpError(500)]);
  const { args, logs } = makeArgs({ inputs: configured, axios });
  await plugin(args);
  assert.match(logs.join('\n'), /HTTP 500/);
});

test('the result goes into the job report section', async () => {
  const { axios } = fakeAxios([listing([{ Id: 'abc', Path: FILE }]), { status: 204 }]);
  const { args } = makeArgs({ inputs: configured, axios, report: true });
  const out = await plugin(args);
  const report = out.variables.fkReport.join('\n');
  assert.match(report, /── File: Notify Jellyfin ──/);
  assert.match(report, /asked to re-read/);
});

// Live check against the real server. Read-only except for one re-read of LIVE_FILE.
const live = process.env.J && process.env.LIVE_FILE;
const fetchAxios = async (config) => {
  const res = await fetch(config.url, { method: config.method.toUpperCase(), headers: config.headers, signal: AbortSignal.timeout(config.timeout) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { response: { status: res.status } });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : '' };
};
const liveInputs = () => ({ jellyfin_url: 'http://jellyfin:8096', jellyfin_api_key: process.env.J });

// The API does not return DateLastRefreshed; the caller checks it in jellyfin.db before and after.
test('live: real Jellyfin accepts the re-read and keeps the added date', { skip: !live }, async () => {
  const headers = { Authorization: `MediaBrowser Token="${process.env.J}"`, Accept: 'application/json' };
  const findItem = async () => {
    const res = await fetch('http://jellyfin:8096/Items?Recursive=true&IncludeItemTypes=Movie,Episode,Video&Fields=Path,DateCreated&EnableImages=false&EnableUserData=false', { headers });
    return (await res.json()).Items.find((i) => i.Path === process.env.LIVE_FILE);
  };
  const before = await findItem();
  assert.ok(before, 'LIVE_FILE must be a path Jellyfin knows');
  const started = Date.now();
  const { args, logs } = makeArgs({ inputs: liveInputs(), axios: fetchAxios, file: process.env.LIVE_FILE });
  await plugin(args);
  console.log(`listing + refresh request took ${Date.now() - started} ms`);
  assert.match(logs.join('\n'), new RegExp(`item ${before.Id}`));
  await new Promise((r) => setTimeout(r, 20000));
  const after = await findItem();
  console.log(`DateCreated ${before.DateCreated} -> ${after.DateCreated}`);
  assert.strictEqual(after.DateCreated, before.DateCreated, 'added date must not change');
});

test('live: a path Jellyfin does not know is skipped', { skip: !live }, async () => {
  const { args, logs } = makeArgs({ inputs: liveInputs(), axios: fetchAxios, file: '/data/media/movies/Not There (1900)/Not There (1900).mkv' });
  await plugin(args);
  assert.match(logs.join('\n'), /does not list this file yet/);
});
