/* eslint-disable */
const details = () => {
  return {
    id: "Tdarr_Plugin_FelipeKbra_HDR_to_SDR",
    Stage: "Pre-processing",
    Name: "FelipeKbra - HDR to SDR",
    Type: "Video",
    Operation: "Transcode",
    Description: "Conversão HDR para SDR de alta fidelidade com sistema de logs expandido para monitoramento.",
    Version: "2.4.1",
    Tags: "video,ffmpeg,hdr,sdr,nvenc,bt2390",
  };
};

async function plugin(file, librarySettings, inputs, otherArguments) {
  let response = {
    processFile: false,
    preset: "",
    container: ".mkv",
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: "",
    file,
  };

  // Log inicial de varredura
  response.infoLog += "🔍 [INFO] Analisando metadados do arquivo...\n";

  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  
  if (!videoStream) {
    response.infoLog += "❌ [ERRO] Nenhuma faixa de vídeo encontrada no arquivo.\n";
    return response;
  }

  // Registra as propriedades de cor detectadas para diagnóstico
  response.infoLog += `📊 [INFO] Color Transfer detectado: ${videoStream.color_transfer || 'Não identificado'}\n`;
  response.infoLog += `📊 [INFO] Color Primaries detectado: ${videoStream.color_primaries || 'Não identificado'}\n`;
  response.infoLog += `📊 [INFO] Resolução original: ${videoStream.width}x${videoStream.height}\n`;

  // Verifica se o arquivo é realmente HDR (smpte2084 / PQ)
  if (videoStream.color_transfer !== 'smpte2084') {
    response.infoLog += "☑ [PULO] O arquivo não utiliza perfil HDR10 (smpte2084). Nenhuma conversão necessária.\n";
    return response;
  }

  response.infoLog += "🚀 [START] HDR10 detectado! Iniciando pipeline de transcodificação via Hardware (NVIDIA NVENC)...\n";
  response.infoLog += "⚙️ [CONFIG] Aplicando algoritmo Tonemapping BT2390 (Peak: 100 nits).\n";
  response.infoLog += "⚙️ [CONFIG] Forçando amostragem yuv420p e metadados no padrão SDR BT.709 para máxima compatibilidade.\n";
  response.infoLog += "⚙️ [CONFIG] Utilizando Preset P4 (VBR / CQ 22) para estabilidade do driver.\n";

  response.preset = `-init_hw_device cuda=cu:0 -filter_hw_device cu -hwaccel cuda -hwaccel_output_format cuda -c:v hevc_cuvid <io> ` +
                    `-vf "tonemap_cuda=tonemap=bt2390:peak=100:desat=0,scale_cuda=format=yuv420p" ` +
                    `-c:v hevc_nvenc -preset p4 -rc vbr -cq 22 ` +
                    `-color_primaries bt709 -color_trc bt709 -colorspace bt709 ` +
                    `-profile:v main ` +
                    `-c:a copy -c:s copy`;

  response.processFile = true;
  response.reQueueAfter = true;

  response.infoLog += "✅ [SUCESSO] Argumentos do FFmpeg gerados e enviados para a fila do Tdarr.\n";

  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;