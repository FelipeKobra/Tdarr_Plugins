/* eslint-disable */
const details = () => {
  return {
    id: "Tdarr_Plugin_FelipeKbra_HDR_to_SDR",
    Stage: "Pre-processing",
    Name: "FelipeKbra - HDR to SDR (Universal GPU)",
    Type: "Video",
    Operation: "Transcode",
    Description: "Versão de alta compatibilidade: remove Temporal AQ e usa preset P4 para evitar erros de hardware.",
    Version: "2.2.0",
    Tags: "video,ffmpeg,hdr,sdr,nvenc,bt2390",
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

  response.infoLog += "☒ Iniciando Transcode (Modo de Compatibilidade NVENC)...\n";

  /**
   * AJUSTES DE COMPATIBILIDADE:
   * 1. Removido -temporal_aq (Causou o seu erro).
   * 2. Trocado -preset slow por -preset p4 (O 'slow' novo da NVIDIA exige hardware mais recente).
   * 3. Mantido o Tonemapping BT2390 (Isso é feito via CUDA cores, deve funcionar).
   * 4. Mantido -rc vbr e -cq 22 para controle de tamanho.
   */
  response.preset = `-init_hw_device cuda=cu:0 -filter_hw_device cu -hwaccel cuda -hwaccel_output_format cuda -c:v hevc_cuvid ` +
                    `, -vf "tonemap_cuda=tonemap=bt2390:peak=100:desat=0:format=p010le" ` +
                    `-c:v hevc_nvenc -preset p4 -rc vbr -cq 22 ` +
                    `-profile:v main10 -rc-lookahead 32 -spatial_aq 1 ` +
                    `-c:a copy -c:s copy`;

  response.processFile = true;
  response.FFmpegMode = true;
  response.reQueueAfter = true;

  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;