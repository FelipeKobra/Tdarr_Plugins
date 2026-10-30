// Names, descriptions, field labels and look of the local flow nodes.
const LOOKS = {
  video: { style: { borderColor: '#b388ff' } },
  audio: { style: { borderColor: '#4fc3f7' } },
  subtitles: { style: { borderColor: '#ffd54f' } },
  streams: { style: { borderColor: '#80cbc4' } },
  file: { style: { borderColor: '#81c784' } },
};
const NEXT = 'Continue to the next step';
const TEXT = {
  removeImages: {
    category: 'video', name: 'Video: Remove Cover Images', icon: 'faFilm',
    desc: 'Removes cover art and images stored as video streams (MJPEG, PNG, GIF).\n\nWhy: they add nothing to playback and confuse some players.',
  },
  hdrToSdr: {
    category: 'video', name: 'Video: HDR to SDR', icon: 'faSun',
    desc: 'Converts HDR10, HLG and Dolby Vision to SDR on the GPU with BT.2390 tone mapping. 4K is downscaled to 1080p, and SDR files pass straight through.\n\nWhy: HDR looks washed out on regular screens.',
    inputs: {
      cq: ['Quality (CQ)', 'Lower means better quality and larger files.'],
      max_bitrate_1080p: ['Max bitrate 1080p', 'In kbps. Never above the source bitrate.'],
      max_bitrate_4KUHD: ['Max bitrate 4K', 'In kbps. Only used when 4K downscaling is off.'],
      downscale_4k_to_1080p: ['Downscale 4K to 1080p', 'true or false.'],
    },
  },
  nvencEncode: {
    category: 'video', name: 'Video: NVENC Encode', icon: 'faMicrochip',
    desc: 'Encodes to 10-bit HEVC with NVENC when it pays off: H.264 above the cap for its resolution, oversized HEVC, or 4K. Good files stay untouched, and files already encoded are recognized and skipped.\n\nWhy: saves space without a needless generation loss.',
  },
  keepNativeLanguages: {
    category: 'audio', name: 'Audio: Keep Languages', icon: 'faLanguage',
    desc: 'Keeps audio in the original language of the title, English, your extra languages and untagged tracks. Everything else is removed. The original language comes from Radarr or Sonarr; if it cannot be found, nothing is removed.\n\nWhy: unwanted dubs waste space.',
    inputs: {
      priority: ['Ask first', 'radarr or sonarr. Comes from the library variable arr_priority.'],
      user_langs: ['Extra languages', 'Comma-separated ISO 639-2 codes, e.g. por'],
      api_key: ['TMDB key', 'Comes from the global variable tmdb_api_key.'],
      radarr_api_key: ['Radarr key', 'Comes from the global variable radarr_api_key.'],
      radarr_url: ['Radarr URL', 'Comes from the global variable radarr_url.'],
      sonarr_api_key: ['Sonarr key', 'Comes from the global variable sonarr_api_key.'],
      sonarr_url: ['Sonarr URL', 'Comes from the global variable sonarr_url.'],
    },
  },
  smartAudioCleanup: {
    category: 'audio', name: 'Audio: Remove Commentary and Duplicates', icon: 'faBroom',
    desc: 'Removes commentary tracks and unlabeled duplicates. An untitled stereo track next to a surround track counts as probable commentary. The main track of each language is always kept.\n\nWhy: a commentary track must never become the only audio left.',
  },
  convertAudio: {
    category: 'audio', name: 'Audio: Convert to AAC', icon: 'faVolumeHigh',
    desc: 'Converts mono and stereo to AAC, and adds an AAC 2.0 downmix for each surround track whose language has no stereo version.\n\nWhy: AAC plays on every device without transcoding.',
    inputs: { aacBitrate: ['Stereo AAC bitrate', 'For example 192k. Mono tracks use half of it.'] },
  },
  removeByChannelCount: {
    category: 'audio', name: 'Audio: Remove Surround', icon: 'faScissors',
    desc: 'Removes surround tracks once a stereo version exists. If that would remove all audio, nothing is removed.\n\nWhy: the library keeps one light, compatible track.',
    inputs: { channelCounts: ['Channel counts to remove', 'Comma-separated, e.g. 3,6,7,8'] },
  },
  ensureAudio: {
    category: 'audio', name: 'Audio: Make Sure Audio Remains', icon: 'faShieldHalved',
    desc: 'Stops the job before anything is written if the original has audio and no track would remain.\n\nWhy: a silent movie must never replace a good file. The original stays intact.',
  },
  cleanSubtitles: {
    category: 'subtitles', name: 'Subtitles: Clean Tracks', icon: 'faClosedCaptioning',
    desc: 'Keeps subtitles in the chosen languages and removes commentary, descriptive and SDH tracks. Tracks with no language get the default one.\n\nWhy: players show a short, correctly named list.',
    inputs: {
      languages: ['Subtitle languages', 'Comma-separated ISO 639-2 codes, e.g. eng,por,spa'],
      tagLanguage: ['Default language', 'Used for subtitles with no language.'],
    },
  },
  extractSubtitles: {
    category: 'subtitles', name: 'Subtitles: Extract to SRT', icon: 'faClosedCaptioning',
    desc: 'Saves text subtitles as .srt files next to the video and removes all subtitles from inside it. This happens in the same ffmpeg run as everything else, and existing .srt files are never overwritten.\n\nWhy: external SRT files avoid burn-in and are easy to replace.',
    inputs: { codecs: ['Formats to extract', 'Comma-separated text subtitle formats.'] },
  },
  cleanSubtitleTags: {
    category: 'subtitles', name: 'Subtitles: Clean SRT Formatting', icon: 'faClosedCaptioning',
    desc: 'Removes position and style tags from the extracted .srt files.\n\nWhy: some players show those tags as plain text.',
  },
  removeAttachments: {
    category: 'streams', name: 'Streams: Remove Attachments', icon: 'faTrash',
    desc: 'Removes embedded attachments such as fonts and cover files.\n\nWhy: with subtitles in SRT, fonts are no longer used.',
  },
  removeUnwantedCodecs: {
    category: 'streams', name: 'Streams: Remove Unwanted Formats', icon: 'faTags',
    desc: 'Removes audio and subtitle formats that would force transcoding on playback, such as DTS, TrueHD and PGS.\n\nCareful: every format listed here leaves the final file.',
    inputs: {
      subtitleCodecs: ['Subtitle formats to remove', 'Comma-separated.'],
      audioCodecs: ['Audio formats to remove', 'Comma-separated.'],
    },
  },
  reorderStreams: {
    category: 'streams', name: 'Streams: Sort', icon: 'faListOl',
    desc: 'Puts video first, then audio and subtitles, in your preferred language order.\n\nWhy: players pick the right track by default.',
    inputs: {
      languages: ['Language order', 'Comma-separated, first to last.'],
      channels: ['Channel order', 'For example 2,1,5.1,7.1'],
      codecs: ['Formats first', 'Formats placed before the others.'],
    },
  },
  conformMkv: {
    category: 'file', name: 'File: Convert to MKV', icon: 'faFileVideo',
    desc: 'Sets MKV as the final container and removes what it cannot hold. Older formats such as AVI and TS get their timestamps repaired.\n\nWhy: one container for the whole library, with fewer sync problems.',
  },
  prepareExecute: {
    category: 'file', name: 'File: Prepare Single Pass', icon: 'faLayerGroup',
    desc: 'Gathers everything decided so far into one command. If there is nothing to do, nothing is written to disk.\n\nWhy: each file is rewritten once at most, which saves hours on slow disks.',
  },
  processFile: {
    category: 'file', name: 'File: Run Single Pass', icon: 'faBolt',
    desc: 'Runs ffmpeg once, doing the cleanup, audio conversion, subtitle extraction and encode together. This is the slow step. A summary of the job appears under the i button of the worker, in Process reasons.\n\nWhy: separate plugins would rewrite the whole file again each time.',
  },
  keepOriginalDate: {
    category: 'file', name: 'File: Keep Original Date', icon: 'faCalendarCheck',
    desc: 'Gives the new file the date of the original.\n\nWhy: otherwise it shows up as newly added in the media server.',
  },
};
module.exports = { LOOKS, NEXT, TEXT };
