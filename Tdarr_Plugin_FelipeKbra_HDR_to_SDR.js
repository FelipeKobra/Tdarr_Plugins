/* eslint-disable */
const details = () => {
  return {
    id: "Tdarr_Plugin_FelipeKbra_HDR_to_SDR",
    Stage: "Pre-processing",
    Name: "FelipeKbra - HDR to SDR (Ultra Quality GPU)",
    Type: "Video",
    Operation: "Transcode",
    Description: "Tonemapping BT2390 via Hardware + 18M Bitrate + Lookahead + Spatial AQ.",
    Version: "2.0.0",
    Tags: "video,ffmpeg,hdr,sdr,nvenc,cuda,bt2390",
  };
};

async function plugin(file, librarySettings, inputs, otherArguments) {
  let response = {
    processFile: false,
    preset: "",
    container: ".mp4",
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: "",
    file,
  };

  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  if (!videoStream || videoStream.color_transfer !== 'smpte2084') {
    response.infoLog += "☑ Arquivo não é HDR10. Pulando.\n";
    return response;
  }

  response.infoLog += "☒ Iniciando Transcode HDR -> SDR (BT2390 + 18Mbps)...\n";

  /**
   * MELHORIAS APLICADAS:
   * 1. Tonemap BT2390: Melhor reprodução de tons que o padrão.
   * 2. Peak=100: Define o brilho alvo para SDR padrão.
   * 3. Desat=0: Evita que as cores percam vivacidade na conversão.
   * 4. HEVC NVENC Main10: Mantém 10-bit para evitar banding, mesmo sendo SDR.
   */
  response.preset = `-init_hw_device cuda=cu:0 -filter_hw_device cu -hwaccel cuda -hwaccel_output_format cuda -c:v hevc_cuvid ` +
                    `, -vf "tonemap_cuda=tonemap=bt2390:peak=100:desat=0:format=p010le" ` +
                    `-c:v hevc_nvenc -preset slow -rc vbr_hq -b:v 18M -maxrate:v 22M -bufsize:v 24M ` +
                    `-profile:v main10 -rc-lookahead 32 -spatial_aq 1 -aq-strength 8 ` +
                    `-c:a copy -c:s copy`;

  response.processFile = true;
  response.FFmpegMode = true;
  response.reQueueAfter = true;

  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;