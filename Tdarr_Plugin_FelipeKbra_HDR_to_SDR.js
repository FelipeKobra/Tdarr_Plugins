/* eslint-disable */
const details = () => {
  return {
    id: "Tdarr_Plugin_FelipeKbra_HDR_to_SDR",
    Stage: "Pre-processing",
    Name: "FelipeKbra - HDR to SDR",
    Type: "Video",
    Operation: "Transcode",
    Description: "High-fidelity HDR to SDR conversion with an expanded log system for monitoring.",
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

  // Initial scanning log
  response.infoLog += "🔍 [INFO] Analyzing file metadata...\n";

  // Find the primary video stream track
  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  
  // Abort execution if no video tracks are found
  if (!videoStream) {
    response.infoLog += "❌ [ERROR] No video stream found in the file.\n";
    return response;
  }

  // Record detected color and structural properties for diagnostics
  response.infoLog += `📊 [INFO] Detected Color Transfer: ${videoStream.color_transfer || 'Not identified'}\n`;
  response.infoLog += `📊 [INFO] Detected Color Primaries: ${videoStream.color_primaries || 'Not identified'}\n`;
  response.infoLog += `📊 [INFO] Original Resolution: ${videoStream.width}x${videoStream.height}\n`;

  // Verify if the file is actually HDR10 (smpte2084 / PQ profile)
  if (videoStream.color_transfer !== 'smpte2084') {
    response.infoLog += "☑ [SKIP] File does not use an HDR10 (smpte2084) profile. No conversion needed.\n";
    return response;
  }

  // Log pipeline initialization parameters
  response.infoLog += "🚀 [START] HDR10 detected! Starting hardware-accelerated transcoding pipeline (NVIDIA NVENC)...\n";
  response.infoLog += "⚙️ [CONFIG] Applying BT2390 Tonemapping algorithm (Peak: 100 nits).\n";
  response.infoLog += "⚙️ [CONFIG] Forcing yuv420p sampling and standard SDR BT.709 metadata for maximum compatibility.\n";
  response.infoLog += "⚙️ [CONFIG] Utilizing Preset P4 (VBR / CQ 22) for driver stability.\n";

  // Construct hardware-accelerated pipeline args using CUDA decoder, tonemap filters, and NVENC parameters
  response.preset = `-init_hw_device cuda=cu:0 -filter_hw_device cu -hwaccel cuda -hwaccel_output_format cuda -c:v hevc_cuvid <io> ` +
                    `-vf "tonemap_cuda=tonemap=bt2390:peak=100:desat=0,scale_cuda=format=yuv420p" ` +
                    `-c:v hevc_nvenc -preset p4 -rc vbr -cq 22 ` +
                    `-color_primaries bt709 -color_trc bt709 -colorspace bt709 ` +
                    `-profile:v main ` +
                    `-c:a copy -c:s copy`;

  // Flag file for processing and ensure proper task scheduling inside Tdarr
  response.processFile = true;
  response.reQueueAfter = true;

  response.infoLog += "✅ [SUCCESS] FFmpeg arguments generated and submitted to the Tdarr queue.\n";

  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;