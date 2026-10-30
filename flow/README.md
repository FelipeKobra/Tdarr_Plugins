# Flow "Process Media"

One Tdarr Flow for all libraries. Every change to a file happens in a single ffmpeg run:
stream cleanup, AAC conversion and downmix, SRT extraction, HDR to SDR and NVENC.
This replaced the classic stack, where each plugin rewrote the whole file.

## Files

- `generate-nodes.js`: writes the local flow nodes. Usage: `node generate-nodes.js <Plugins/FlowPlugins/LocalFlowPlugins>`
- `node-text.js`: names, descriptions, field labels, icons and colors of the nodes.
- `flow-test.js`: builds the flow, runs the classic vs flow comparison and installs it.
  Usage: `docker exec -i -e K=<api key> tdarr node - <mode> < flow-test.js`
  Modes: setup, compare, teardown, realfail, stabletest, hdrcase, state, install, rollback.

## Rules for local flow nodes

- Path must be `LocalFlowPlugins/<category>/<name>/<version>/index.js`, or the UI shows "Unable to read plugin".
- After changing a node, POST `/api/v2/sync-plugins`: the worker runs its own copy.
- A cloned stream needs its own `index`: ffmpegCommandExecute finds output positions by index.

## Variables

Global: radarr_url, radarr_api_key, sonarr_url, sonarr_api_key, tmdb_api_key.
Library: arr and arr_priority (radarr or sonarr).

## Rollback

Set `decisionMaker.settingsFlows=false` and `settingsPlugin=true` on each library, or run mode `rollback`.
The classic stacks remain stored in `pluginIDs`.
