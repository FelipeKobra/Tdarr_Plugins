# Custom Tdarr Plugin Suite — Engineered by FelipeKbra

This repository contains a high-performance, fully automated media post-processing and library orchestration suite developed for **Tdarr**. These plugins operate in synergy with media managers (**Radarr** and **Sonarr**) to deliver efficient hardware transcoding, intelligent subtitle management, smart audio track normalization, and real-time metadata synchronization.

---

## 🛠️ Detailed Plugin Breakdown & Engineering Advantages

### 1. FelipeKbra - H264/HEVC to NVENC Focused on MKV Containers (Pure CUDA Opt)
* **ID:** `Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC`
* **Stage:** Pre-processing
* **Operation:** Transcode

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

---

### 2. FelipeKbra - HDR to SDR
* **ID:** `Tdarr_Plugin_FelipeKbra_HDR_to_SDR`
* **Stage:** Pre-processing
* **Operation:** Transcode

#### 🎯 Main Function:
Identifies high-dynamic-range profiles (HDR10) and processes a high-fidelity down-conversion into standard-dynamic-range (SDR) formats with verbose pipeline logging.

#### 🚀 Why It Differs from Standard Plugins:
* **GPU-Accelerated Tone Mapping:** Standard community alternatives rely on CPU-bound tonemapping packages (such as `zscale`), which degrade encoding performance down to single-digit frames-per-second and overheat host processors. This plugin invokes specialized **CUDA hardware tone-mapping algorithms (`tonemap_cuda=tonemap=bt2390`)** entirely inside the graphics hardware layer.
* **Strict Chrominance & Luminance Correction:** It handles desaturation parameters natively (`desat=0`), applies hardware pixel scaling directly to the standard `yuv420p` layout, and strictly overrides output color spaces to standard Rec. 709 metadata boundaries (`-color_primaries bt709 -color_trc bt709 -colorspace bt709`). This ensures vibrant, crush-free, and highly compatible SDR streams without CPU intervention.

#### 🎛️ Input Parameters:
* *None* (Self-orchestrated via dynamic file probe checks).

---

### 3. FelipeKbra - Extract Subtitles and Name It Correctly Based on Brazilian or European Source
* **ID:** `Tdarr_Plugin_FelipeKbra_Subtitles_Extractor`
* **Stage:** Pre-processing
* **Operation:** Transcode

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

### 4. FelipeKbra - Smart Remove Commentary and Duplicate Audio Tracks
* **ID:** `Tdarr_Plugin_FelipeKbra_Smart_Remove_Commentaries_and_Duplicates`
* **Stage:** Pre-processing
* **Operation:** Transcode

#### 🎯 Main Function:
Cleans audio ecosystems inside video containers by dropping explicit director commentary tracks and redundant lower-quality duplicate tracks while intentionally defending fallback stereo chains.

#### 🚀 Why It Differs from Standard Plugins:
* **Language-Isolated Pool Analysis:** Standard audio cleaners blindly look across a file and delete any stream that doesn't have the maximum channel count, which corrupts setups requiring a stereo fallback track for web direct-play. This plugin groups audio tracks by individual language codes first. It identifies the highest surround layout (e.g., 8ch or 6ch) and actively protects legitimate stereo downmix channels (like high-quality 2ch AAC/AC3 lines) from elimination.
* **Blind Duplicate Purging:** It identifies and purges unlabelled "blind" duplicate channels (e.g., secondary hidden low-bitrate 2ch streams of the same codec).
* **Multi-Lingual Commentary Matrix:** It screens stream dispositions (`comment` flag) and parses title tags through a robust multi-lingual string regex matrix (`commentary`, `comentário`, `director`, `diretor`, `cast`) to wipe commentary lines with high accuracy.

#### 🎛️ Input Parameters:
* *None* (Fully automated logic based on stream-by-stream validation pools).

---

### 5. FelipeKbra - Remux + Web Optimize Check
* **ID:** `Tdarr_Plugin_FelipeKbra_Remux`
* **Stage:** Pre-processing
* **Operation:** Transcode

#### 🎯 Main Function:
Standardizes video container structures into clean `.mkv` or `.mp4` formats while continuously checking for web streaming direct-play compatibility.

#### 🚀 Why It Differs from Standard Plugins:
* **Active Moov Atom Verification:** Generic remuxers blindly copy streams across containers, often outputting files that fail to buffer effectively on web platforms. This plugin actively parses `MediaInfo` outputs to audit the placement of the **Moov Atom header (`IsStreamable`)**. If it encounters an MP4 file with its index trapped at the tail-end of the binary layout, it intercepts it and forces a remux with `-movflags +faststart` to move atoms to the front, optimizing it for instant direct-play streaming on Plex, Jellyfin, or Emby.
* **Legacy Container Timestamp Rebuilding:** It automatically detects legacy, unstable source containers (`.ts`, `.avi`, `.mpg`, `.vob`) and injects the `-fflags +genpts` parameters to recalculate and fix missing or broken internal presentation timestamps on-the-fly.

#### 🎛️ Input Parameters:
* `container` (String | Default: `mkv`): Desired target file extension enclosure format (`mkv` or `mp4`).
* `force_conform` (Boolean | Default: `false`): Enforces safe track removal conventions based on destination specifications (e.g., dropping raw bitmap PGS subtitles if converting to MP4 to prevent player errors).

---

### 6. FelipeKbra - Radarr/Sonarr Tag Manager - Remove and Add Tags
* **ID:** `Tdarr_Plugin_FelipeKbra_Tag_Manager`
* **Stage:** Post-processing
* **Operation:** Transcode

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
* `radarr_tag_to_remove` / `radarr_tag_to_add` (Text): Text strings used to update the database state.

---

### 7. FelipeKbra - Notify Radarr and/or Sonarr of Media Changes
* **ID:** `Tdarr_Plugin_FelipeKbra_reload_media_on_radarr_or_sonarr`
* **Stage:** Post-processing
* **Operation:** Transcode

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
