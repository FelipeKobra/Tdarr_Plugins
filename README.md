# Custom Tdarr Plugin Suite — Engineered by FelipeKbra

This repository contains a high-performance, fully automated media post-processing and library orchestration suite developed for **Tdarr**. These plugins operate in synergy with media managers (**Radarr** and **Sonarr**) to deliver efficient hardware transcoding, intelligent subtitle management, smart audio track normalization, and real-time metadata synchronization.

Several plugins are forks of great work from the Tdarr community. Every derived plugin carries a `// Based on ...` header in its source file, and the full list of origins is in [Credits & Origins](#-credits--origins).

---

## 📦 Plugin Index

| # | Plugin | Stage | Origin |
|---|--------|-------|--------|
| 1 | [H264/HEVC to NVENC (MKV)](#1-felipekbra---h264hevc-to-nvenc-focused-on-mkv-containers-pure-cuda-opt) | Pre-processing | Fork of purpan's NVENC plugin |
| 2 | [H264/HEVC to QSV (MKV)](#2-felipekbra---h264hevc-to-qsv-focused-on-mkv-containers-pure-intel-qsv-opt) | Pre-processing | Intel QSV port of #1 |
| 3 | [HDR to SDR](#3-felipekbra---hdr-to-sdr) | Pre-processing | Original |
| 4 | [Subtitles Extractor](#4-felipekbra---extract-subtitles-and-name-it-correctly-based-on-brazilian-or-european-source) | Pre-processing | Fork of drpeppershaker's extractor |
| 5 | [Keep Native Language + English](#5-felipekbra---remove-all-langs-except-native-and-english) | Pre-processing | Fork of henk's plugin |
| 6 | [Smart Remove Commentary & Duplicates](#6-felipekbra---smart-remove-commentary-and-duplicate-audio-tracks) | Pre-processing | Original |
| 7 | [Convert Audio Streams](#7-felipekbra---convert-audio-streams) | Pre-processing | Fork of Migz Convert Audio |
| 8 | [Remux + Web Optimize Check](#8-felipekbra---remux--web-optimize-check) | Pre-processing | Fork of Migz Remux |
| 9 | [Radarr/Sonarr Tag Manager](#9-felipekbra---radarrsonarr-tag-manager---remove-and-add-tags) | Post-processing | Original |
| 10 | [Notify Radarr/Sonarr](#10-felipekbra---notify-radarr-andor-sonarr-of-media-changes) | Post-processing | Original |

---

## 🛠️ Detailed Plugin Breakdown & Engineering Advantages

### 1. FelipeKbra - H264/HEVC to NVENC Focused on MKV Containers (Pure CUDA Opt)
* **ID:** `Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC_MKV`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** [`Tdarr_Plugin_purpan_H264_HEVC_to_NVENC_optional_HDR`](https://github.com/axel-devs/Tdarr-H264-HEVC-to-NVENC-with-Optional-HDR) by **purpan (axel-devs)**, which itself builds on **tws101**'s *Ultimate GPU Transcoder HDR*. The loop-prevention tag check is adapted from [`Tdarr_Plugin_00td_filter_by_stream_tag`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_00td_filter_by_stream_tag.js).

#### 🎯 Main Function:
Transcodes older H.264 video streams or high-bitrate/bloated HEVC files into a standard, highly compressed 10-bit HEVC stream inside an MKV container using hardware-accelerated NVIDIA NVENC.

#### 🚀 Why It Differs from Standard Plugins:
* **Pure CUDA Zero-Copy Pipeline:** Traditional community plugins bottleneck hardware performance by continuously shifting video frames back and forth between host CPU RAM and GPU VRAM when executing video filters or color adjustments. This plugin enforces a strict native hardware pipeline, keeping frames inside VRAM from decoding (`cuvid`), through scaling/pixel formatting (`scale_cuda`), to encoding (`hevc_nvenc`).
* **Resolution-Adaptive Bitrate Ceilings:** Rather than applying a single blind bitrate target, it evaluates file dimensions and maps files against dynamic, resolution-specific thresholds (480p up to 4K UHD).
* **Native HDR Passthrough Guard:** It explicitly tracks color properties (`bt2020`, `bt2020nc`, `smpte2084`) and reapplies structural HDR tags during conversion to prevent washed-out colors.
* **In-Stream Loop Prevention Flag:** Instead of relying on vulnerable local cache files or external state tracking databases, it injects a custom, persistent global metadata flag (`COPYRIGHT=processed`) directly into the file stream. Future scans identify this tag instantly and skip the file, completely preventing recursive transcoding loops.

#### 🎛️ Input Parameters:
* `target_bitrate_480p576p` (Number | Default: `1000`): Bitrate target in kbps for low-resolution files.
* `target_bitrate_720p` (Number | Default: `2000`): Bitrate target in kbps for 720p files.
* `target_bitrate_1080p` (Number | Default: `4000`): Bitrate target in kbps for 1080p files.
* `target_bitrate_4KUHD` (Number | Default: `8000`): Bitrate target in kbps for 4K UHD content.
* `target_pct_reduction` (Number | Default: `0.5`): Fallback reduction percentage if original H.264 bitrate sits under the static resolution caps.
* `bframes` (Boolean | Default: `false`): Enables or disables lookahead B-Frames (`-bf 2 -b_ref_mode middle`) within NVENC.
* `reconvert_hevc` (Boolean | Default: `true`): Forces processing on pre-existing HEVC assets if they exceed the filter bitrates.
* `reconvert_hdr` (Boolean | Default: `true`): Dictates whether files containing High Dynamic Range metadata should be re-encoded.
* `hevc_480p_576p_filter_bitrate` to `hevc_filter_bitrate_4KUHD`: Custom thresholds to instantly skip files already encoded in efficient HEVC if they fall below these values.
* `tagName` / `tagValues` (Strings | Default: `COPYRIGHT` / `processed`): Custom signature settings for loop protection.
* `exactMatch` (Boolean | Default: `true`): Whether the tag value must match exactly or just be contained in the tag.
* `continueIfTagFound` (Boolean | Default: `false`): Process the file even if the loop-protection tag is already present.

---

### 2. FelipeKbra - H264/HEVC to QSV Focused on MKV Containers (Pure Intel QSV Opt)
* **ID:** `Tdarr_Plugin_FelipeKbra_H264_HEVC_to_QSV_MKV`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** Intel Quick Sync port of plugin #1, so it shares the same lineage: [purpan (axel-devs)](https://github.com/axel-devs/Tdarr-H264-HEVC-to-NVENC-with-Optional-HDR) → **tws101**'s *Ultimate GPU Transcoder HDR*.

#### 🎯 Main Function:
Same goal as the NVENC plugin (H.264 or bloated HEVC → 10-bit HEVC in MKV), but encoded with **Intel Quick Sync Video** (`hevc_qsv`). Requires an Intel GPU with QSV (7th gen+/Iris/Arc recommended).

#### 🚀 Why It Differs from Standard Plugins:
* **Zero-Copy QSV Pipeline:** Frames are decoded with the matching QSV decoder (`h264_qsv`, `hevc_qsv`, `vp9_qsv`, `av1_qsv`, ...), converted to 10-bit on the GPU with `vpp_qsv=format=p010le`, and encoded with `hevc_qsv` without ever leaving GPU memory.
* **Automatic Hardware Device Discovery:** On Linux it scans `/dev/dri` for the first `renderD*` node and passes it via `-qsv_device`; on Windows it initialises QSV over `d3d11va`. No render device path needs to be configured by hand.
* **Correct Tdarr Worker Routing:** QSV is initialised directly (`-init_hw_device qsv=hw`) instead of being derived from VAAPI. Tdarr picks the worker type by scanning the ffmpeg command for keywords, so keeping the word `vaapi` out of the command stops jobs from getting stuck on "Require VAAPI Worker" when the node is a QSV worker.
* **Smart VBR Tuning:** `-look_ahead` / `-look_ahead_depth 40` / `-extbrc` plus `-global_quality` per resolution tier mirror NVENC's multipass + lookahead behaviour, while `-b:v` / `-maxrate` keep the bitrate ceiling.
* **10-bit H.264 Fallback:** QSV cannot decode 10-bit H.264, so for those sources the hardware decoder is disabled and decoding falls back to the CPU while encoding stays on the GPU.
* **Same Loop Protection and HDR Guard** as the NVENC plugin (`COPYRIGHT=processed` tag, BT.2020/SMPTE 2084 metadata passthrough).

#### 🎛️ Input Parameters:
Same inputs as the NVENC plugin, with these differences:
* `reconvert_hdr` (Boolean | Default: `false`): HDR files are skipped unless enabled.
* `bframes` (Boolean | Default: `false`): Adds `-bf 2 -b_strategy 1` (B-pyramid, the QSV equivalent of NVENC's `-b_ref_mode middle`).
* All other inputs (`target_bitrate_*`, `target_pct_reduction`, `reconvert_hevc`, `hevc_*_filter_bitrate`, `tagName`, `tagValues`, `exactMatch`, `continueIfTagFound`) behave and default exactly as described in plugin #1.

---

### 3. FelipeKbra - HDR to SDR
* **ID:** `Tdarr_Plugin_FelipeKbra_HDR_to_SDR`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Origin:** Original plugin (no upstream).

#### 🎯 Main Function:
Identifies high-dynamic-range profiles (HDR10) and processes a high-fidelity down-conversion into standard-dynamic-range (SDR) formats with verbose pipeline logging.

#### 🚀 Why It Differs from Standard Plugins:
* **GPU-Accelerated Tone Mapping:** Standard community alternatives rely on CPU-bound tonemapping packages (such as `zscale`), which degrade encoding performance down to single-digit frames-per-second and overheat host processors. This plugin invokes specialized **CUDA hardware tone-mapping algorithms (`tonemap_cuda=tonemap=bt2390`)** entirely inside the graphics hardware layer.
* **Strict Chrominance & Luminance Correction:** It handles desaturation parameters natively (`desat=0`), applies hardware pixel scaling directly to the standard `yuv420p` layout, and strictly overrides output color spaces to standard Rec. 709 metadata boundaries (`-color_primaries bt709 -color_trc bt709 -colorspace bt709`). This ensures vibrant, crush-free, and highly compatible SDR streams without CPU intervention.

#### 🎛️ Input Parameters:
* *None* (Self-orchestrated via dynamic file probe checks).

---

### 4. FelipeKbra - Extract Subtitles and Name It Correctly Based on Brazilian or European Source
* **ID:** `Tdarr_Plugin_FelipeKbra_Subtitles_Extractor`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** [`Tdarr_Plugin_rr01_drpeppershaker_extract_subs_to_SRT`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_rr01_drpeppershaker_extract_subs_to_SRT.js) (v1.06) by **drpeppershaker** (with help from reddit user /u/jakejones48, itself inspired by HaveAGitGat's `Tdarr_Plugin_078d`).

#### 🎯 Main Function:
Isolates embedded text-based subtitle tracks, extracts them into standalone external `.srt` files side-by-side with the media file, handles styling sanitization, and strips them from the original video container if configured.

#### 🚀 Why It Differs from Standard Plugins:
* **Dual-Pass Regional Dialect Sorting:** Standard subtitle extractors match basic ISO codes blindly, labeling any Portuguese track as standard `.pt.srt`, which causes video players to display European Portuguese instead of Brazilian Portuguese. This plugin evaluates both the language code (`por`/`pt`) and evaluates track title strings for deep markers (`brazilian`, `br`) to accurately output `.pt-BR.srt` vs `.pt.srt`.
* **Automated Accessibility Identification:** It reads internal stream disposition tracks to catch the `hearing_impaired` flag, appending `.sdh` directly to filenames dynamically (e.g., `.pt-BR.sdh.srt`).
* **Regular Expression Text Cleaning:** During a structured re-queue stage (`reQueueAfter: true`), it reads the external subtitle payload and fires high-performance Regex scripts to strip advanced positioning tags from formats like ASS/SSA (`{\an8}`, `{\pos(x,y)}`) and HTML aesthetic code elements (`<i>`, `<font>`) to ensure uniform rendering across simple players.

#### 🎛️ Input Parameters:
* `remove_subs` (Dropdown | Options: `no`, `yes`): Controls whether internal text subtitles should be removed from the video track after successful external isolation.
* `remove_tags` (Dropdown | Options: `no`, `yes`): Toggles whether styling vectors and HTML layouts get scrubbed via regex.
* `subtitle_codecs` (Text | Default: `subrip`): Comma-separated list of text-based codecs eligible for extraction (e.g., `subrip,ass,ssa,mov_text`).

---

### 5. FelipeKbra - Remove All Langs Except Native And English
* **ID:** `Tdarr_Plugin_FelipeKbra_Keep_Native_Lang_Plus_Eng`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** [`Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng.js) (v1.2) by **henk**.

#### 🎯 Main Function:
Removes every audio track whose language is not the title's **original (native) language**, **English**, **undefined** (`und`), or one of the extra languages you list. The native language is resolved through Radarr/Sonarr and TMDB.

#### 🚀 Why It Differs from the Original:
* **No `axios` Dependency:** All HTTP calls use native Node.js `http`/`https` behind a small promise helper, so the plugin only depends on `@cospired/i18n-iso-languages` and doesn't break when Tdarr's bundled packages change.
* **Radarr Native Language Shortcut:** For movies it reads `originalLanguage` straight from Radarr's `/api/v3/parse` response, so the TMDB lookup (and TMDB key) isn't needed for movies.
* **Explicit Error Reporting:** Non-200 answers and connection errors from Radarr, Sonarr and TMDB are written to the Tdarr log instead of failing silently.
* **Safety Guards (kept from upstream):** Tracks without tags or a language tag are kept, and the plugin cancels itself if the removal would leave the file with no audio at all.

#### 🎛️ Input Parameters:
* `user_langs` (Text | Default: empty): Extra ISO-639-2 languages to keep, comma-separated (e.g. `por,nld`). English and `und` are always kept.
* `priority` (Text | Default: `sonarr`): Which *arr to query first (`radarr` or `sonarr`).
* `api_key` (Text): TMDB (v3) API key. Used on the Sonarr path to look up the series' native language from its IMDb id (Sonarr id, or a `tt1234567` id in the filename as a last resort).
* `radarr_api_key` / `radarr_url` (Text | Default URL: `radarr:7878`): Radarr connection. Accepts `http://`, `https://` or `host:port`.
* `sonarr_api_key` / `sonarr_url` (Text | Default URL: `sonarr:8989`): Sonarr connection. Accepts `http://`, `https://` or `host:port`.

---

### 6. FelipeKbra - Smart Remove Commentary and Duplicate Audio Tracks
* **ID:** `Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Origin:** Original plugin (no upstream).

#### 🎯 Main Function:
Cleans audio ecosystems inside video containers by dropping explicit director commentary tracks and redundant lower-quality duplicate tracks while intentionally defending fallback stereo chains.

#### 🚀 Why It Differs from Standard Plugins:
* **Language-Isolated Pool Analysis:** Standard audio cleaners blindly look across a file and delete any stream that doesn't have the maximum channel count, which corrupts setups requiring a stereo fallback track for web direct-play. This plugin groups audio tracks by individual language codes first. It identifies the highest surround layout (e.g., 8ch or 6ch) and actively protects legitimate stereo downmix channels (like high-quality 2ch AAC/AC3 lines) from elimination.
* **Blind Duplicate Purging:** It identifies and purges unlabelled "blind" duplicate channels (e.g., secondary hidden low-bitrate 2ch streams of the same codec).
* **Multi-Lingual Commentary Matrix:** It screens stream dispositions (`comment` flag) and parses title tags through a robust multi-lingual string regex matrix (`commentary`, `comentário`, `director`, `diretor`, `cast`) to wipe commentary lines with high accuracy.

#### 🎛️ Input Parameters:
* *None* (Fully automated logic based on stream-by-stream validation pools).

---

### 7. FelipeKbra - Convert Audio Streams
* **ID:** `Tdarr_Plugin_FelipeKbra_Convert_Audio`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** [`Tdarr_Plugin_MC93_Migz5ConvertAudio`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_MC93_Migz5ConvertAudio.js) (v2.6) by **Migz**.

#### 🎯 Main Function:
Converts 2.0 audio tracks to AAC for maximum device compatibility and creates missing downmixed tracks: a 5.1 AC3 track from 7.1/6.1 sources, and a 2.0 AAC track from any multichannel source.

#### 🚀 Why It Differs from the Original:
* **Downmix From Any Multichannel Layout:** The original only created stereo from 6/8-channel tracks. This version creates the missing 2.0 track from **any** track with more than 2 channels (2.1, 4.0, 5.0, 5.1, 6.1, 7.1, ...).
* **Correct Per-Stream ffmpeg Addressing:** The original addressed codec options to the *source* stream index and used a global `-ac`, which could change the channel count of unrelated tracks. Every new track now gets its own `-c:a:N`, `-ac:a:N` and metadata addressed to its **output** index, so existing tracks are copied untouched.
* **Language & Title Preservation:** Downmixed tracks inherit the source language tag and get a clean title (`2.0` / `5.1`), or optionally the original title with the new layout appended (`E-AC-3 Atmos 5.1 - 2.0`). It won't produce a duplicated suffix such as `... 2.0 - 2.0`.
* **Command-Line Safe Metadata:** Quotes, backticks, `$` and backslashes are stripped from titles/languages before they reach the ffmpeg command.

#### 🎛️ Input Parameters:
* `aac_stereo` (Boolean | Default: `false`): Convert any non-AAC 2.0 track to AAC.
* `downmix` (Boolean | Default: `false`): Create missing 5.1 / 2.0 tracks from higher-channel tracks.
* `downmix_single_track` (Boolean | Default: `false`): Only create one downmix per layout instead of one per source track.
* `preserve_channel_title` (Boolean | Default: `false`): Append the new layout to the original title instead of replacing it.

---

### 8. FelipeKbra - Remux + Web Optimize Check
* **ID:** `Tdarr_Plugin_FelipeKbra_Remux`
* **Stage:** Pre-processing
* **Operation:** Transcode
* **Based on:** [`Tdarr_Plugin_MC93_Migz1Remux`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_MC93_Migz1Remux.js) (v1.2) by **Migz**.

#### 🎯 Main Function:
Standardizes video container structures into clean `.mkv` or `.mp4` formats while continuously checking for web streaming direct-play compatibility.

#### 🚀 Why It Differs from Standard Plugins:
* **Active Moov Atom Verification:** Generic remuxers blindly copy streams across containers, often outputting files that fail to buffer effectively on web platforms. This plugin actively parses `MediaInfo` outputs to audit the placement of the **Moov Atom header (`IsStreamable`)**. If it encounters an MP4 file with its index trapped at the tail-end of the binary layout, it intercepts it and forces a remux with `-movflags +faststart` to move atoms to the front, optimizing it for instant direct-play streaming on Plex, Jellyfin, or Emby.
* **Legacy Container Timestamp Rebuilding:** It automatically detects legacy, unstable source containers (`.ts`, `.avi`, `.mpg`, `.vob`) and injects the `-fflags +genpts` parameters to recalculate and fix missing or broken internal presentation timestamps on-the-fly.

#### 🎛️ Input Parameters:
* `container` (String | Default: `mkv`): Desired target file extension enclosure format (`mkv` or `mp4`).
* `force_conform` (Boolean | Default: `false`): Enforces safe track removal conventions based on destination specifications (e.g., dropping raw bitmap PGS subtitles if converting to MP4 to prevent player errors).

---

### 9. FelipeKbra - Radarr/Sonarr Tag Manager - Remove and Add Tags
* **ID:** `Tdarr_Plugin_FelipeKbra_Tag_Manager`
* **Stage:** Post-processing
* **Operation:** Transcode
* **Origin:** Original plugin (no upstream).

#### 🎯 Main Function:
Interacts with the APIs of your media servers during the post-processing phase, automatically stripping processing tags and applying customized labels to signify file status changes.

#### 🚀 Why It Differs from Standard Plugins:
* **Dynamic Lifecycle Tag Provisioning (`ensureTagExists`):** Standard management automation requires users to look up internal database integer tag IDs manually and hardcode them into parameters. This script includes a smart lifecycle engine: it queries current server tag configurations via standard `GET` requests, performs string comparisons, and automatically issues a `POST` request to build labels (such as generating a `transcoded` label out of thin air) if they are missing.
* **URI-Compliant Asset Identification:** It encodes filenames via `encodeURIComponent` and queries the low-level `/api/v3/parse` endpoint to accurately locate ownership of a media file, allowing safe label updates using native network operations (`PUT`).

#### 🎛️ Input Parameters:
* `radarr_enabled` / `sonarr_enabled` (Boolean | Default: `false`): Activates sync interfaces for Movies or TV Show environments.
* `radarr_server` / `sonarr_server` (Text | Default: `192.168.1.100`): Network connection endpoints.
* `radarr_port` / `sonarr_port` (Text | Default: `7878` / `8989`): Targeted network interface gates.
* `radarr_api_key` / `sonarr_api_key` (Text): Secure verification authentication strings.
* `radarr_tag_to_remove` / `radarr_tag_to_add` and `sonarr_tag_to_remove` / `sonarr_tag_to_add` (Text): Text strings used to update the database state.

---

### 10. FelipeKbra - Notify Radarr and/or Sonarr of Media Changes
* **ID:** `Tdarr_Plugin_FelipeKbra_reload_media_on_radarr_or_sonarr`
* **Stage:** Post-processing
* **Operation:** Transcode
* **Origin:** Original classic plugin. The lookup-then-refresh approach (`/api/v3/parse` → `RefreshMovie` / `RefreshSeries`) is the same one used by Tdarr's official [`notifyRadarrOrSonarr`](https://github.com/HaveAGitGat/Tdarr_Plugins/tree/master/FlowPluginsTs/CommunityFlowPlugins/tools/notifyRadarrOrSonarr) flow plugin.

#### 🎯 Main Function:
Forces Radarr and Sonarr to instantly re-analyze the specific movie or series file as soon as Tdarr finishes saving changes, updating file sizes and structural metadata on the web dash immediately.

#### 🚀 Why It Differs from Standard Plugins:
* **Zero External Node Dependencies:** Standard notification scripts load large third-party network packages (like `axios` or `request`), which often cause dependency errors during Tdarr platform updates. This plugin uses **native Node.js `http` and `https` standard libraries** wrapped inside a lightweight asynchronous promise architecture.
* **Explicit Targeted Database Commands:** Instead of triggering a heavy, slow global folder re-scan, it routes files via the `/api/v3/parse` system to find their exact media assignment. Once resolved, it triggers explicit targeted database actions (`RefreshSeries` or `RefreshMovie`) to update the asset immediately without unnecessary server load.

#### 🎛️ Input Parameters:
* `radarr_enabled` / `sonarr_enabled` (Boolean | Default: `false`): Toggles notification triggers for specific media categories.
* `radarr_server` / `sonarr_server` (String | Default: `192.168.1.100`): Targeted application location IP coordinates.
* `radarr_port` / `sonarr_port` (String | Default: `7878` / `8989`): Operating service network port configurations.
* `radarr_api_key` / `sonarr_api_key` (String): Master authentication security tokens.

---

## 🔗 Recommended Stack Order

The order used in production (`plugin_order.txt`), mixing these local plugins with community ones:

1. `Tdarr_Plugin_lmg1_Reorder_Streams` (Community)
2. `Tdarr_Plugin_MC93_MigzImageRemoval` (Community)
3. `Tdarr_Plugin_MC93_Migz4CleanSubs` (Community)
4. `Tdarr_Plugin_FelipeKbra_Keep_Native_Lang_Plus_Eng`
5. `Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates`
6. `Tdarr_Plugin_00td_action_remove_stream_by_specified_property` (Community)
7. `Tdarr_Plugin_FelipeKbra_Convert_Audio`
8. `Tdarr_Plugin_00td_action_remove_audio_by_channel_count` (Community)
9. `Tdarr_Plugin_FelipeKbra_Subtitles_Extractor`
10. `Tdarr_Plugin_MP01_MichPasCleanSubsAndAudioCodecs` (Community)
11. `Tdarr_Plugin_00td_action_re_order_all_streams_v2` (Community)
12. `Tdarr_Plugin_FelipeKbra_Remux`
13. `Tdarr_Plugin_FelipeKbra_HDR_to_SDR`
14. `Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC_MKV` (or the QSV variant on Intel hardware)
15. `Tdarr_Plugin_a9he_New_file_size_check` (Community)
16. `Tdarr_Plugin_z80t_keep_original_date` (Community)
17. `Tdarr_Plugin_FelipeKbra_reload_media_on_radarr_or_sonarr`

---

## 🙏 Credits & Origins

Thanks to the authors whose work these plugins build on:

| Local plugin | Upstream plugin | Author |
|--------------|-----------------|--------|
| `H264_HEVC_to_NVENC_MKV` | [`Tdarr_Plugin_purpan_H264_HEVC_to_NVENC_optional_HDR`](https://github.com/axel-devs/Tdarr-H264-HEVC-to-NVENC-with-Optional-HDR) → *Ultimate GPU Transcoder HDR* | purpan (axel-devs) → tws101 |
| `H264_HEVC_to_NVENC_MKV` (tag check) | [`Tdarr_Plugin_00td_filter_by_stream_tag`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_00td_filter_by_stream_tag.js) | HaveAGitGat |
| `H264_HEVC_to_QSV_MKV` | Port of `H264_HEVC_to_NVENC_MKV` (same lineage as above) | purpan (axel-devs) → tws101 |
| `Subtitles_Extractor` | [`Tdarr_Plugin_rr01_drpeppershaker_extract_subs_to_SRT`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_rr01_drpeppershaker_extract_subs_to_SRT.js) | drpeppershaker |
| `Keep_Native_Lang_Plus_Eng` | [`Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng.js) | henk |
| `Convert_Audio` | [`Tdarr_Plugin_MC93_Migz5ConvertAudio`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_MC93_Migz5ConvertAudio.js) | Migz |
| `Remux` | [`Tdarr_Plugin_MC93_Migz1Remux`](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/Tdarr_Plugin_MC93_Migz1Remux.js) | Migz |
| `HDR_to_SDR`, `Smart_Remove_Commentaries_and_Duplicates`, `Tag_Manager`, `reload_media_on_radarr_or_sonarr` | Original (no upstream) | FelipeKbra |

All community plugins live in the official [HaveAGitGat/Tdarr_Plugins](https://github.com/HaveAGitGat/Tdarr_Plugins) repository.
