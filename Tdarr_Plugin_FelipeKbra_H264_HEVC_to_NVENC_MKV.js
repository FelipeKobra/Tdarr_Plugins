/* eslint-disable */
// Based on Tdarr_Plugin_purpan_H264_HEVC_to_NVENC_optional_HDR by purpan (axel-devs):
//   https://github.com/axel-devs/Tdarr-H264-HEVC-to-NVENC-with-Optional-HDR
// which in turn builds on tws101's Ultimate GPU Transcoder HDR plugin.
// Loop-prevention tag check adapted from Tdarr_Plugin_00td_filter_by_stream_tag.
// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_H264_HEVC_to_NVENC_MKV',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - H264/HEVC to NVENC Focused on MKV Containers (Pure CUDA Opt)',
  Type: 'Video',
  Operation: 'Transcode',
  Description:
    `Transcodes H264 (or re-encodes bloated HEVC/VP9/AV1) to 10-bit HEVC with NVENC using constant quality (CQ)
    capped by a per-resolution max bitrate. Hardware decoding is used only when NVDEC supports the source;
    otherwise frames are decoded on the CPU and uploaded to the GPU. Interlaced sources are deinterlaced.
    Requires an NVIDIA GPU with HEVC NVENC (GTX 16xx / RTX 20xx or newer).`,
  Version: '2.3',
  Tags: 'pre-processing,ffmpeg,nvenc h265, hdr, cuda',
  Inputs: [
    {
      name: 'skip_h264_within_cap',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Skip H264 whose video bitrate is already within the tier max bitrate. On cards without HEVC '
        + 'B-frames (GTX 16xx) NVENC HEVC is about as efficient as x264, so re-encoding a good encode only loses '
        + 'quality for little space. Interlaced sources and 4K downscales are still processed.',
    },
    {
      name: 'target_bitrate_480p576p',
      type: 'number',
      defaultValue: 2000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 480p/576p. Quality is driven by CQ; this only caps complex scenes.',
    },
    {
      name: 'target_bitrate_720p',
      type: 'number',
      defaultValue: 4000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 720p. Quality is driven by CQ; this only caps complex scenes.',
    },
    {
      name: 'target_bitrate_1080p',
      type: 'number',
      defaultValue: 15000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 1080p. 1440p uses 1.8x this value. Quality is driven by CQ. On a GTX 1650, '
        + 'CQ 19 capped at 9 Mbps scored VMAF 70-90 on hard 50 fps clips; 15 Mbps scored 83-91 and the curve flattens above.',
    },
    {
      name: 'target_bitrate_4KUHD',
      type: 'number',
      defaultValue: 24000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 4K UHD. Quality is driven by CQ; this only caps complex scenes.',
    },
    {
      name: 'target_pct_reduction',
      type: 'number',
      defaultValue: 0.85,
      inputUI: { type: 'text' },
      tooltip: 'The max bitrate never exceeds source video bitrate x this factor, so the output is always smaller. '
        + 'NVENC HEVC without B-frames needs ~85% of the H264 bitrate for equivalent quality.',
    },
    {
      name: 'downscale_4k_to_1080p',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Downscales 4K UHD video to 1080p (CQ/bitrate of the 1080p tier) so it streams to more clients. '
        + '4K files are always processed when enabled, even HEVC below the bloat threshold.',
    },
    {
      name: 'cq_480p576p',
      type: 'number',
      defaultValue: 19,
      inputUI: { type: 'text' },
      tooltip: 'NVENC constant quality for 480p/576p. Lower = better quality and bigger files.',
    },
    {
      name: 'cq_720p',
      type: 'number',
      defaultValue: 20,
      inputUI: { type: 'text' },
      tooltip: 'NVENC constant quality for 720p. Lower = better quality and bigger files.',
    },
    {
      name: 'cq_1080p',
      type: 'number',
      defaultValue: 19,
      inputUI: { type: 'text' },
      tooltip: 'NVENC constant quality for 1080p and 1440p. Lower = better quality and bigger files.',
    },
    {
      name: 'cq_4KUHD',
      type: 'number',
      defaultValue: 20,
      inputUI: { type: 'text' },
      tooltip: 'NVENC constant quality for 4K UHD. Lower = better quality and bigger files.',
    },
    {
      name: 'bframes',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Enables HEVC B-frames (-bf 3 -b_ref_mode middle). Requires Turing NVENC (RTX 20xx, GTX 1660/1650 Super) '
        + 'or newer. The GTX 1650 (TU117) has Volta NVENC and FAILS with this enabled.',
    },
    {
      name: 'deinterlace',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Deinterlace interlaced sources (field_order tt/bb/tb/bt) with bwdif.',
    },
    {
      name: 'reconvert_hevc',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Re-encode HEVC/VP9/AV1 video whose bitrate is above the hevc_*_filter_bitrate thresholds.',
    },
    {
      name: 'reconvert_hdr',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Re-encode HDR10/HLG files keeping HDR color metadata. Dolby Vision files are always skipped.',
    },
    {
      name: 'hevc_480p_576p_filter_bitrate',
      type: 'number',
      defaultValue: 3000,
      inputUI: { type: 'text' },
      tooltip: 'HEVC/VP9/AV1 480p/576p video bitrate (kbps) above which the file is re-encoded. Keep ~1.5x the max bitrate '
        + 'so re-encoding only happens when the saving is worth the generation loss.',
    },
    {
      name: 'hevc_720p_filter_bitrate',
      type: 'number',
      defaultValue: 6000,
      inputUI: { type: 'text' },
      tooltip: 'HEVC/VP9/AV1 720p video bitrate (kbps) above which the file is re-encoded.',
    },
    {
      name: 'hevc_1080p_filter_bitrate',
      type: 'number',
      defaultValue: 22000,
      inputUI: { type: 'text' },
      tooltip: 'HEVC/VP9/AV1 1080p video bitrate (kbps) above which the file is re-encoded. 1440p uses 1.8x this value.',
    },
    {
      name: 'hevc_filter_bitrate_4KUHD',
      type: 'number',
      defaultValue: 35000,
      inputUI: { type: 'text' },
      tooltip: 'HEVC/VP9/AV1 4K UHD video bitrate (kbps) above which the file is re-encoded.',
    },
    {
      name: 'tagName',
      type: 'string',
      defaultValue: 'COPYRIGHT',
      inputUI: { type: 'text' },
      tooltip: 'Name of the metadata tag to check/apply to prevent processing loops (e.g., COPYRIGHT).',
    },
    {
      name: 'tagValues',
      type: 'string',
      defaultValue: 'processed',
      inputUI: { type: 'text' },
      tooltip: 'Comma-separated values for the metadata tag to check. The first value is written on output.',
    },
    {
      name: 'exactMatch',
      type: 'boolean',
      defaultValue: true,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'Whether the metadata tag value must match exactly or just be contained within the tag.',
    },
    {
      name: 'continueIfTagFound',
      type: 'boolean',
      defaultValue: false,
      inputUI: { type: 'dropdown', options: ['false', 'true'] },
      tooltip: 'If true, processing will continue even if the specified metadata tag value is already found.',
    },
  ],
});

const MODERN_CODECS = ['hevc', 'vp9', 'av1'];
const INTERLACED_ORDERS = ['tt', 'bb', 'tb', 'bt'];
const HW_420_FORMATS = ['yuv420p', 'yuvj420p', 'nv12'];
const HW_420_10BIT_FORMATS = ['yuv420p10le', 'p010le'];
// Codecs NVDEC decodes on Turing and newer. AV1 is left to the CPU (dav1d): Turing has no AV1 NVDEC.
const HW_DECODE_FORMATS = {
  h264: HW_420_FORMATS,
  hevc: [...HW_420_FORMATS, ...HW_420_10BIT_FORMATS],
  vp9: [...HW_420_FORMATS, ...HW_420_10BIT_FORMATS],
  mpeg2video: HW_420_FORMATS,
  vc1: HW_420_FORMATS,
};

class Log {
  constructor() { this.entries = []; }
  Add(entry) { this.entries.push(entry); }
  AddSuccess(entry) { this.entries.push(`☑ ${entry}`); }
  AddError(entry) { this.entries.push(`☒ ${entry}`); }
  GetLogData() { return `${this.entries.join('\n')}\n`; }
}

const toKbps = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n / 1000 : null;
};

// MKV rarely has stream bit_rate; mkvmerge writes it to the BPS / BPS-eng tags instead.
const streamKbps = (stream) => toKbps(stream.bit_rate)
  || toKbps(stream.tags?.BPS)
  || toKbps(stream.tags?.['BPS-eng']);

function getVideoBitrateKbps(file, videoStream) {
  const direct = streamKbps(videoStream);
  if (direct) return direct;
  const total = toKbps(file.ffProbeData?.format?.bit_rate) || toKbps(file.bit_rate);
  if (!total) return null;
  const audioKbps = file.ffProbeData.streams
    .filter((s) => s.codec_type === 'audio')
    .reduce((sum, s) => sum + (streamKbps(s) || 0), 0);
  const estimate = total - audioKbps;
  return estimate > 0 ? estimate : null;
}

function getTier(stream, inputs) {
  const w = stream.width || 0;
  const h = stream.height || 0;
  if (w >= 3200 || h >= 1800) {
    return { name: '4KUHD', cap: inputs.target_bitrate_4KUHD, cq: inputs.cq_4KUHD, filter: inputs.hevc_filter_bitrate_4KUHD };
  }
  if (w >= 2200 || h >= 1300) {
    return {
      name: '1440p',
      cap: Math.round(inputs.target_bitrate_1080p * 1.8),
      cq: inputs.cq_1080p,
      filter: Math.round(inputs.hevc_1080p_filter_bitrate * 1.8),
    };
  }
  if (w >= 1700 || h >= 900) {
    return { name: '1080p', cap: inputs.target_bitrate_1080p, cq: inputs.cq_1080p, filter: inputs.hevc_1080p_filter_bitrate };
  }
  if (w >= 1100 || h >= 650) {
    return { name: '720p', cap: inputs.target_bitrate_720p, cq: inputs.cq_720p, filter: inputs.hevc_720p_filter_bitrate };
  }
  return { name: 'SD', cap: inputs.target_bitrate_480p576p, cq: inputs.cq_480p576p, filter: inputs.hevc_480p_576p_filter_bitrate };
}

const isAttachedPicture = (stream) => stream.disposition?.attached_pic === 1
  || ['mjpeg', 'png', 'bmp', 'gif'].includes(stream.codec_name);

const isDolbyVision = (stream) => (stream.side_data_list || [])
  .some((sd) => String(sd.side_data_type || '').toLowerCase().includes('dovi'));

const isHDR = (stream) => ['smpte2084', 'arib-std-b67'].includes(stream.color_transfer)
  || stream.color_primaries === 'bt2020';

const canHwDecode = (stream) => (HW_DECODE_FORMATS[stream.codec_name] || []).includes(stream.pix_fmt);

function checkTags(file, inputs) {
  const { strHasValue } = require('../methods/utils');
  if (inputs.tagName === '' || inputs.tagValues === '') return { processFile: true, infoLog: '' };

  const tagName = inputs.tagName;
  const tagValues = inputs.tagValues.split(',').map((v) => v.trim());
  const hasTag = file.ffProbeData.streams
    .some((s) => s?.tags && strHasValue(tagValues, s.tags[tagName], inputs.exactMatch));

  if (hasTag && !inputs.continueIfTagFound) {
    return { processFile: false, infoLog: `☑ Tag ${tagName} encontrada. Ignorando arquivo para evitar loops.\n` };
  }
  return { processFile: true, infoLog: '' };
}

// Decides whether the video needs encoding and at which tier. Returns null when it should be skipped.
function planEncode(file, stream, inputs, logger) {
  if (isDolbyVision(stream)) {
    logger.AddSuccess('Dolby Vision detectado. Pulando para não perder o RPU/cores.');
    return null;
  }
  const hdr = isHDR(stream);
  if (hdr && !inputs.reconvert_hdr) {
    logger.AddSuccess('HDR detectado e reconvert_hdr=false. Pulando.');
    return null;
  }

  const sourceTier = getTier(stream, inputs);
  const downscale = inputs.downscale_4k_to_1080p && sourceTier.name === '4KUHD';
  const tier = downscale ? { ...getTier({ width: 1920, height: 1080 }, inputs), name: '4KUHD → 1080p' } : sourceTier;
  const sourceKbps = getVideoBitrateKbps(file, stream);
  logger.Add(`Vídeo ${stream.codec_name} ${stream.width}x${stream.height} (${tier.name}), `
    + `bitrate ${sourceKbps ? `${Math.round(sourceKbps)} kbps` : 'desconhecido'}, pix_fmt ${stream.pix_fmt}`);

  if (MODERN_CODECS.includes(stream.codec_name) && !downscale) {
    if (!inputs.reconvert_hevc) {
      logger.AddSuccess(`${stream.codec_name} e reconvert_hevc=false. Pulando.`);
      return null;
    }
    if (!sourceKbps || sourceKbps <= tier.filter) {
      logger.AddSuccess(`${stream.codec_name} abaixo do limite de ${tier.filter} kbps. Pulando.`);
      return null;
    }
  }

  const interlaced = inputs.deinterlace && INTERLACED_ORDERS.includes(stream.field_order);
  if (stream.codec_name === 'h264' && inputs.skip_h264_within_cap && !downscale && !interlaced
      && sourceKbps && sourceKbps <= tier.cap) {
    logger.AddSuccess(`h264 de ${Math.round(sourceKbps)} kbps dentro do teto de ${tier.cap} kbps. `
      + 'Mantendo o vídeo original (re-encode só perderia qualidade).');
    return null;
  }

  const reductionCap = sourceKbps ? Math.round(sourceKbps * inputs.target_pct_reduction) : Infinity;
  const maxrate = Math.max(500, Math.min(tier.cap, reductionCap));
  return { tier, maxrate, hdr, downscale };
}

// Fits the video into 1920 wide keeping the aspect ratio (3840x2160 -> 1920x1080, 3840x1600 -> 1920x800).
const DOWNSCALE_FILTER = 'scale_cuda=w=1920:h=-2:interp_algo=lanczos';

function buildVideoArgs(stream, plan, inputs) {
  const interlaced = inputs.deinterlace && INTERLACED_ORDERS.includes(stream.field_order);
  const hwDecode = canHwDecode(stream);

  const inputArgs = hwDecode
    ? '-hwaccel cuda -hwaccel_output_format cuda'
    : '-init_hw_device cuda=cu:0 -filter_hw_device cu';
  const filters = hwDecode
    ? [interlaced && 'bwdif_cuda=0:-1:1', 'scale_cuda=format=p010le', plan.downscale && DOWNSCALE_FILTER]
    : [interlaced && 'bwdif=0:-1:1', 'format=p010le', 'hwupload_cuda', plan.downscale && DOWNSCALE_FILTER];

  const tagValue = inputs.tagValues.split(',')[0].trim();
  const encoder = [
    '-c:v:0 hevc_nvenc -gpu 0 -profile:v:0 main10',
    `-vf "${filters.filter(Boolean).join(',')}"`,
    '-preset p7 -tune hq -multipass fullres',
    `-rc vbr -cq ${plan.tier.cq} -b:v 0 -maxrate ${plan.maxrate}k -bufsize ${plan.maxrate * 2}k`,
    // High tier: the auto-picked Main-tier level silently caps 1080p at ~12-20 Mbps, below the max bitrate.
    '-tier high',
    '-rc-lookahead 32 -spatial-aq 1 -aq-strength 8 -surfaces 64',
    inputs.bframes ? '-bf 3 -b_ref_mode middle' : '-bf 0',
  ];
  if (plan.hdr) {
    encoder.push(`-color_primaries bt2020 -colorspace bt2020nc -color_trc ${stream.color_transfer || 'smpte2084'}`);
  }
  if (inputs.tagName && tagValue) {
    encoder.push(`-metadata:s:v:0 ${inputs.tagName}=${tagValue}`);
  }
  return { inputArgs, encoderArgs: encoder.join(' '), hwDecode, interlaced };
}

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    container: `.${file.container}`,
    FFmpegMode: true,
    handBrakeMode: false,
    infoLog: '',
    processFile: false,
    preset: '',
    reQueueAfter: true,
  };
  const logger = new Log();

  if (file.fileMedium !== 'video') {
    response.infoLog += '☒ File is not a video.\n';
    return response;
  }

  const tagCheck = checkTags(file, inputs);
  if (!tagCheck.processFile) {
    response.infoLog += tagCheck.infoLog;
    return response;
  }

  const videoStream = file.ffProbeData.streams
    .find((s) => s.codec_type === 'video' && !isAttachedPicture(s));
  if (!videoStream) {
    response.infoLog += '☒ Nenhum stream de vídeo encontrado.\n';
    return response;
  }

  const plan = planEncode(file, videoStream, inputs, logger);
  if (!plan) {
    response.infoLog += logger.GetLogData();
    return response;
  }

  const video = buildVideoArgs(videoStream, plan, inputs);
  logger.Add(`Decode: ${video.hwDecode ? 'NVDEC (GPU)' : 'CPU + hwupload_cuda'}${video.interlaced ? ', deinterlace bwdif' : ''}`);
  logger.AddSuccess(`Encoding HEVC 10-bit NVENC p7/hq, CQ ${plan.tier.cq}, maxrate ${plan.maxrate} kbps`
    + `${plan.downscale ? ', 4K reduzido para 1080p' : ''}`);

  // Map the main video explicitly (drops cover art / extra angles), keep every audio, subtitle and attachment.
  const outputArgs = [
    `-map 0:${videoStream.index} -map 0:a? -map 0:s? -map 0:t?`,
    video.encoderArgs,
    '-c:a copy -c:s copy -c:t copy -max_muxing_queue_size 9999',
  ].join(' ');

  response.preset = `${video.inputArgs},${outputArgs}`;
  response.processFile = true;
  response.infoLog += logger.GetLogData();
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
