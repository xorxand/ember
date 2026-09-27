import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Speech } from "../server/speech.mjs";

test("local speech transcription validates models, audio and cleans temporary data", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ember-speech-"));
  const binary = path.join(directory, "fake-whisper");
  await fs.writeFile(
    binary,
    `#!/usr/bin/env node
import fs from 'node:fs';
const output = process.argv[process.argv.indexOf('-of') + 1];
fs.writeFileSync(output + '.txt', ' dictated locally ');
`,
    { mode: 0o755 },
  );
  const store = new Store(path.join(directory, "data"));
  const speech = new Speech(store, { binary });
  t.after(async () => {
    await speech.close();
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  assert.equal(speech.status.available, true);
  await assert.rejects(
    speech.transcribe(Buffer.alloc(44), "not-a-model"),
    /Unknown speech model/,
  );
  await assert.rejects(
    speech.transcribe(Buffer.alloc(44), "base.en"),
    /Download the selected speech model/,
  );
  await fs.writeFile(speech.modelPath("base.en"), "test weights");
  const result = await speech.transcribe(Buffer.alloc(48), "base.en");
  assert.deepEqual(result, { text: "dictated locally" });
  assert.equal(speech.status.busy, false);
  await speech.remove("base.en");
  assert.equal(
    speech.status.models.find((m) => m.name === "base.en").installed,
    false,
  );
});
