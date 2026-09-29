/* eslint-disable */
const details = () => ({
  id: 'Tdarr_Plugin_FelipeKbra_HDR_to_SDR',
  Stage: 'Pre-processing',
  Name: 'FelipeKbra - HDR to SDR',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'GPU HDR10/HLG to SDR (BT.709) tonemapping with tonemap_cuda (BT.2390) and 10-bit HEVC NVENC output. '
    + 'Keeps every audio/subtitle track and tags the video so the NVENC plugin does not re-encode it again.',
  Version: '3.0',
  Tags: 'video,ffmpeg,hdr,sdr,nvenc,bt2390',
  Inputs: [
    {
      name: 'cq',
      type: 'number',
      defaultValue: 22,
      inputUI: { type: 'text' },
      tooltip: 'NVENC constant quality of the SDR output. Lower = better quality and bigger files.',
    },
    {
      name: 'max_bitrate_1080p',
      type: 'number',
      defaultValue: 8000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 1080p and below.',
    },
    {
      name: 'max_bitrate_4KUHD',
      type: 'number',
      defaultValue: 20000,
      inputUI: { type: 'text' },
      tooltip: 'Max bitrate (kbps) for 4K UHD.',
    },
    {
      name: 'tagName',
      type: 'string',
      defaultValue: 'COPYRIGHT',
      inputUI: { type: 'text' },
      tooltip: 'Metadata tag written on the output so the NVENC plugin skips it (must match its tagName).',
    },
    {
      name: 'tagValue',
      type: 'string',
      defaultValue: 'processed',
      inputUI: { type: 'text' },
      tooltip: 'Metadata tag value written on the output (must match the NVENC plugin tagValues).',
    },
  ],
});

const HDR_TRANSFERS = ['smpte2084', 'arib-std-b67'];
// NVDEC formats usable on Turing (no AV1 decode there, so AV1 goes through the CPU).
const HW_DECODE_FORMATS = {
  hevc: ['yuv420p', 'yuv420p10le', 'p010le'],
  vp9: ['yuv420p', 'yuv420p10le', 'p010le'],
  h264: ['yuv420p', 'yuvj420p'],
};

const isAttachedPicture = (stream) => stream.disposition?.attached_pic === 1
  || ['mjpeg', 'png', 'bmp', 'gif'].includes(stream.codec_name);

const canHwDecode = (stream) => (HW_DECODE_FORMATS[stream.codec_name] || []).includes(stream.pix_fmt);

async function plugin(file, librarySettings, inputs, otherArguments) {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);
  const response = {
    processFile: false,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: '',
  };

  const videoStream = file.ffProbeData.streams
    .find((s) => s.codec_type === 'video' && !isAttachedPicture(s));
  if (!videoStream) {
    response.infoLog += '☒ Nenhum stream de vídeo encontrado.\n';
    return response;
  }

  const transfer = videoStream.color_transfer || 'unknown';
  response.infoLog += `📊 ${videoStream.codec_name} ${videoStream.width}x${videoStream.height}, `
    + `transfer ${transfer}, primaries ${videoStream.color_primaries || 'unknown'}, pix_fmt ${videoStream.pix_fmt}\n`;

  // Dolby Vision profile 5 has no HDR10 base layer (transfer is not PQ/HLG) and is skipped by this check too.
  if (!HDR_TRANSFERS.includes(transfer)) {
    response.infoLog += '☑ Não é HDR10/HLG. Nada a fazer.\n';
    return response;
  }

  const is4k = (videoStream.width || 0) >= 3200 || (videoStream.height || 0) >= 1800;
  const maxrate = is4k ? inputs.max_bitrate_4KUHD : inputs.max_bitrate_1080p;
  const hwDecode = canHwDecode(videoStream);

  const tonemap = 'tonemap_cuda=tonemap=bt2390:peak=100:desat=0:format=p010'
    + ':transfer=bt709:matrix=bt709:primaries=bt709:range=tv';
  const inputArgs = hwDecode
    ? '-hwaccel cuda -hwaccel_output_format cuda'
    : '-init_hw_device cuda=cu:0 -filter_hw_device cu';
  const filters = hwDecode ? tonemap : `format=p010le,hwupload_cuda,${tonemap}`;

  const outputArgs = [
    `-map 0:${videoStream.index} -map 0:a? -map 0:s? -map 0:t?`,
    `-c:v:0 hevc_nvenc -gpu 0 -profile:v:0 main10 -vf "${filters}"`,
    '-preset p7 -tune hq -multipass fullres',
    `-rc vbr -cq ${inputs.cq} -b:v 0 -maxrate ${maxrate}k -bufsize ${maxrate * 2}k`,
    '-rc-lookahead 32 -spatial-aq 1 -aq-strength 8 -surfaces 64 -bf 0',
    '-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv',
    inputs.tagName && inputs.tagValue ? `-metadata:s:v:0 ${inputs.tagName}=${inputs.tagValue}` : '',
    '-c:a copy -c:s copy -c:t copy -max_muxing_queue_size 9999',
  ].filter(Boolean).join(' ');

  response.preset = `${inputArgs},${outputArgs}`;
  response.processFile = true;
  response.infoLog += `🚀 ${transfer} → SDR BT.709 (tonemap_cuda BT.2390, 100 nits), `
    + `decode ${hwDecode ? 'NVDEC' : 'CPU'}, HEVC 10-bit CQ ${inputs.cq}, maxrate ${maxrate} kbps\n`;
  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;
