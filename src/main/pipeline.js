const fs = require("node:fs/promises");
const path = require("node:path");
const defaults = require("../config/defaults");
const store = require("./store");
const { transcribe } = require("./transcribe");
const { pasteText } = require("./paste");

/** Minimum audio duration (seconds) to avoid Whisper hallucinations */
const MIN_AUDIO_DURATION = 0.4;

async function runPipeline(wavBuffer, { sendStatus, sendOverlay }) {
  const wavPath = path.join(defaults.paths.tmp, "vapenvibe-recording.wav");
  const buf = Buffer.from(wavBuffer);
  await fs.writeFile(wavPath, buf);

  try {
    // Skip transcription for very short audio (< MIN_AUDIO_DURATION)
    // WAV header is 44 bytes, 16-bit mono 16kHz = 32000 bytes/sec
    const audioDuration = Math.max(0, (buf.length - 44) / 32000);
    if (audioDuration < MIN_AUDIO_DURATION) {
      console.log(
        `[pipeline] Audio too short (${audioDuration.toFixed(2)}s), skipping`,
      );
      sendStatus("idle");
      sendOverlay("idle");
      return;
    }

    sendOverlay("processing");
    sendStatus("transcribing");
    console.log("[pipeline] Transcribing audio...");
    let text = await transcribe(wavPath, store.get("language"));
    console.log("[pipeline] Transcription result:", text);

    sendStatus("idle");
    sendOverlay("idle");

    if (text && text.trim()) {
      try {
        await pasteText(text.trim());
      } catch (err) {
        console.error("[pipeline] Paste failed:", err.message);
      }
    }
  } catch (err) {
    console.error("[pipeline] Transcription error:", err);
    sendStatus("idle");
    sendOverlay("idle");
  } finally {
    try {
      await fs.unlink(wavPath);
    } catch {
      // best-effort cleanup
    }
  }
}

module.exports = { runPipeline };
