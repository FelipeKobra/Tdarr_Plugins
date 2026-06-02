/* eslint-disable */
const details = () => {
  return {
    id: "Tdarr_Plugin_FelipeKbra_RemoveDolbyVision",
    Stage: "Pre-processing",
    Name: "FelipeKbra - Remove Dolby Vision (English Enhanced)",
    Type: "Video",
    Operation: "Transcode",
    Description: "Identifies Dolby Vision HEVC streams, extracts them, removes DV metadata using dovi_tool (leaving HDR10/base layer), and remuxes back into MKV.",
    Version: "1.3",
    Tags: "pre-processing,ffmpeg,video,hevc,dovitools,mkvmerge",
  };
};

async function plugin(file, librarySettings, inputs, otherArguments) {
  const spawn = require("child_process").spawnSync;
  const fs = require("fs");
  const path = require("path");

  let response = {
    processFile: false,
    preset: "",
    container: ".mkv",
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: "",
    file,
    removeFromDB: false,
    updateDB: false,
  };

  // 1. Identify HEVC and Dolby Vision
  const videoStream = file.ffProbeData.streams.find(s => s.codec_type === 'video');
  
  if (!videoStream || videoStream.codec_name !== 'hevc') {
    response.infoLog += "☑ File is not HEVC. Skipping Dolby Vision check.\n";
    return response;
  }

  const hasDV = videoStream?.side_data_list?.some(
    (data) => data.side_data_type === "DOVI configuration record"
  );

  if (!hasDV) {
    response.infoLog += "☑ No Dolby Vision metadata detected. Skipping.\n";
    return response;
  }

  response.infoLog += "☒ Dolby Vision detected. Starting removal process...\n";

  // 2. Binary Availability Check
  const checkBinary = (cmd) => {
    const check = spawn(cmd, ["--version"]);
    return check.status === 0;
  };

  if (!checkBinary("dovi_tool")) {
    response.infoLog += "☒ Error: 'dovi_tool' not found in system path. Please install it.\n";
    return response;
  }

  // 3. Setup Paths
  const workFolder = path.dirname(otherArguments.cacheFilePath);
  const origHevc = path.join(workFolder, `${file._id}_original_extract.hevc`);
  const procHevc = path.join(workFolder, `${file._id}_processed_nodovi.hevc`);
  const outputPath = otherArguments.cacheFilePath;

  try {
    // 4. Extraction
    response.infoLog += "➔ Step 1/3: Extracting HEVC stream (using hevc_mp4toannexb)...\n";
    const extract = spawn("tdarr-ffmpeg", [
      "-i", file.file,
      "-map", `0:${videoStream.index}`,
      "-c:v", "copy",
      "-bsf:v", "hevc_mp4toannexb",
      "-f", "hevc",
      origHevc,
      "-y"
    ]);
    
    if (extract.status !== 0) {
        response.infoLog += `☒ Extraction failed: ${extract.stderr.toString()}\n`;
        throw new Error("FFmpeg extraction failed.");
    }
    response.infoLog += "✔ HEVC stream extracted successfully.\n";

    // 5. dovi_tool Processing
    response.infoLog += "➔ Step 2/3: Removing Dolby Vision RPU metadata...\n";
    const dovi = spawn("dovi_tool", ["remove", "-i", origHevc, "-o", procHevc]);
    
    if (dovi.status !== 0) {
        response.infoLog += `☒ dovi_tool failed: ${dovi.stderr.toString()}\n`;
        throw new Error("dovi_tool processing failed.");
    }
    response.infoLog += "✔ Dolby Vision metadata removed.\n";

    // 6. Final Remux
    response.infoLog += "➔ Step 3/3: Final remux with mkvmerge (keeping original audio/subs)...\n";
    const mkvmerge = spawn("mkvmerge", [
      "-o", outputPath,
      procHevc,          // New video track
      "--no-video", 
      file.file          // Take audio/subs/chapters from original
    ]);

    if (mkvmerge.status !== 0) {
        response.infoLog += `☒ mkvmerge failed: ${mkvmerge.stderr.toString()}\n`;
        throw new Error("mkvmerge remux failed.");
    }
    response.infoLog += "✔ Remux completed successfully.\n";

    // 7. Cleanup
    if (fs.existsSync(origHevc)) fs.unlinkSync(origHevc);
    if (fs.existsSync(procHevc)) fs.unlinkSync(procHevc);

    // 8. Re-queue for verification
    response.processFile = false;
    response.reQueueAfter = true; 
    response.infoLog += "☒ Process finished. File requeued to verify metadata removal.\n";

  } catch (err) {
    response.infoLog += `Critical Error: ${err.message}\n`;
    // Attempt cleanup on failure
    if (fs.existsSync(origHevc)) fs.unlinkSync(origHevc);
    if (fs.existsSync(procHevc)) fs.unlinkSync(procHevc);
    return response;
  }

  return response;
}

module.exports.details = details;
module.exports.plugin = plugin;