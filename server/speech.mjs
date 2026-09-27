import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const speechModels = {
  "tiny.en": {
    label: "Fast · English",
    size: 77_704_715,
    sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
  },
  "base.en": {
    label: "Balanced · English",
    size: 147_964_211,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  },
  "small.en": {
    label: "Accurate · English",
    size: 487_614_201,
    sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
  },
  base: {
    label: "Balanced · Multilingual",
    size: 147_951_465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  },
};

const modelName = (name) => {
  if (!speechModels[name]) throw new Error("Unknown speech model.");
  return name;
};

export class Speech {
  constructor(store, { binary } = {}) {
    this.store = store;
    this.directory = path.join(store.directory, "speech");
    this.binary =
      binary ||
      process.env.EMBER_WHISPER_BINARY ||
      path.join(root, "vendor", "whisper", "whisper-cli");
    this.controller = null;
    this.downloadPromise = null;
    this.busy = false;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  modelPath(name) {
    return path.join(this.directory, `ggml-${modelName(name)}.bin`);
  }
  get status() {
    const models = Object.entries(speechModels).map(([name, model]) => ({
      name,
      ...model,
      installed: fs.existsSync(this.modelPath(name)),
    }));
    return {
      available: fs.existsSync(this.binary),
      busy: this.busy,
      download: this.downloadStatus || null,
      models,
    };
  }
  async download(name) {
    name = modelName(name);
    if (this.controller)
      throw new Error("A speech model download is already running.");
    const model = speechModels[name];
    const target = this.modelPath(name);
    const partial = `${target}.partial`;
    this.controller = new AbortController();
    this.downloadStatus = {
      name,
      status: "downloading",
      completed: 0,
      total: model.size,
    };
    this.store.emit("change");
    try {
      const response = await fetch(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`,
        { signal: this.controller.signal },
      );
      if (!response.ok || !response.body)
        throw new Error(`Speech model download failed (${response.status}).`);
      const file = await fsp.open(partial, "w", 0o600);
      const hash = createHash("sha256");
      let completed = 0;
      try {
        for await (const chunk of response.body) {
          completed += chunk.length;
          hash.update(chunk);
          await file.write(chunk);
          this.downloadStatus = {
            name,
            status: "downloading",
            completed,
            total: model.size,
          };
          this.store.emit("change");
        }
      } finally {
        await file.close();
      }
      if (completed !== model.size || hash.digest("hex") !== model.sha256)
        throw new Error(
          "Speech model verification failed. The incomplete download was discarded.",
        );
      await fsp.rename(partial, target);
      this.downloadStatus = {
        name,
        status: "complete",
        completed,
        total: model.size,
      };
    } catch (error) {
      await fsp.rm(partial, { force: true });
      this.downloadStatus = {
        name,
        status: error.name === "AbortError" ? "cancelled" : "failed",
        error: error.name === "AbortError" ? null : error.message,
      };
      if (error.name !== "AbortError") throw error;
    } finally {
      this.controller = null;
      this.store.emit("change");
    }
    return this.status;
  }
  cancel() {
    this.controller?.abort();
  }
  async remove(name) {
    if (this.busy) throw new Error("Wait for transcription to finish.");
    await fsp.rm(this.modelPath(name), { force: true });
    this.store.emit("change");
    return this.status;
  }
  async transcribe(audio, name, language = "auto") {
    name = modelName(name);
    if (!fs.existsSync(this.binary))
      throw new Error(
        "The local speech engine is not installed in this Ember build.",
      );
    if (!fs.existsSync(this.modelPath(name)))
      throw new Error("Download the selected speech model in Settings first.");
    if (this.busy) throw new Error("Another transcription is still running.");
    if (
      !Buffer.isBuffer(audio) ||
      audio.length < 44 ||
      audio.length > 32_000_000
    )
      throw new Error("Recording must be a WAV file under 32 MB.");
    const temporary = await fsp.mkdtemp(
      path.join(os.tmpdir(), "ember-dictation-"),
    );
    const input = path.join(temporary, "recording.wav");
    const output = path.join(temporary, "transcript");
    this.busy = true;
    this.store.emit("change");
    try {
      await fsp.writeFile(input, audio, { mode: 0o600 });
      await new Promise((resolve, reject) => {
        const args = [
          "-m",
          this.modelPath(name),
          "-f",
          input,
          "-otxt",
          "-of",
          output,
          "-np",
          "-nt",
          "-l",
          name.endsWith(".en") ? "en" : language,
        ];
        const child = spawn(this.binary, args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let error = "";
        child.stderr.on("data", (chunk) => {
          error = (error + chunk).slice(-8000);
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  error.trim() || `Transcription exited with code ${code}.`,
                ),
              ),
        );
      });
      const text = (await fsp.readFile(`${output}.txt`, "utf8")).trim();
      if (!text) throw new Error("No speech was detected.");
      return { text };
    } finally {
      this.busy = false;
      this.store.emit("change");
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  }
  async close() {
    this.cancel();
    await this.downloadPromise?.catch(() => {});
  }
}
