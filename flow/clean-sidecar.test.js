// Tests for the hand-written Clean Sidecar Files node (nodes/cleanSidecarSubtitles.js).
// Usage: docker exec tdarr node --test /app/server/Tdarr/Plugins/Local/flow/clean-sidecar.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request.endsWith('methods/lib')) {
    return () => ({ loadDefaultValues: (inputs, details) => ({
      ...Object.fromEntries(details().inputs.map((i) => [i.name, i.defaultValue])), ...inputs,
    }) });
  }
  return realLoad.call(this, request, ...rest);
};
const { plugin } = require(path.join(__dirname, 'nodes', 'cleanSidecarSubtitles.js'));

const BASE = 'Some Film (2001)';
const run = (names, inputs = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-'));
  [`${BASE}.mkv`, ...names].forEach((n) => fs.writeFileSync(path.join(dir, n), 'x'));
  const logs = [];
  const video = path.join(dir, `${BASE}.mkv`);
  const out = plugin({ inputs, originalLibraryFile: { _id: video }, inputFileObj: { _id: video }, variables: {}, jobLog: (l) => logs.push(l) });
  const left = fs.readdirSync(dir).filter((n) => n.endsWith('.srt')).sort();
  fs.rmSync(dir, { recursive: true, force: true });
  return { out, left, log: logs.join('\n') };
};

test('keeps kept languages, regional variants and flags; removes the rest', () => {
  const { out, left, log } = run([
    `${BASE}.en.srt`, `${BASE}.pt-BR.srt`, `${BASE}.por.forced.srt`, `${BASE}.es-419.sdh.srt`,
    `${BASE}.fr.srt`, `${BASE}.de.forced.srt`, `${BASE}.zh-Hans.srt`,
  ]);
  assert.strictEqual(out.outputNumber, 1);
  assert.deepStrictEqual(left, [`${BASE}.en.srt`, `${BASE}.es-419.sdh.srt`, `${BASE}.por.forced.srt`, `${BASE}.pt-BR.srt`].sort());
  assert.match(log, /☒ Removed: fr\.srt/);
  assert.match(log, /☒ Removed: zh-Hans\.srt/);
});

test('leaves files with no language, a number, or another video name', () => {
  const { left, log } = run([`${BASE}.srt`, `${BASE}.2.srt`, `${BASE}.forced.srt`, 'Other Film.fr.srt', `${BASE}.Director Commentary.srt`]);
  assert.strictEqual(left.length, 5);
  assert.match(log, /☑ Nothing to change/);
});

test('the languages setting changes what is kept', () => {
  const { left } = run([`${BASE}.en.srt`, `${BASE}.fr.srt`], { languages: 'fre' });
  assert.deepStrictEqual(left, [`${BASE}.fr.srt`]);
});

test('a missing folder is reported without stopping the flow', () => {
  const logs = [];
  const out = plugin({ inputs: {}, originalLibraryFile: { _id: '/nonexistent/dir/x.mkv' }, inputFileObj: { _id: '/nonexistent/dir/x.mkv' }, variables: {}, jobLog: (l) => logs.push(l) });
  assert.strictEqual(out.outputNumber, 1);
  assert.match(logs.join('\n'), /Could not clean sidecar subtitles/);
});
