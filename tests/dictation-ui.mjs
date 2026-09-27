import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama } from "./mock-ollama.mjs";

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "ember-dictation-ui-"),
);
const binary = path.join(directory, "fake-whisper");
await fs.writeFile(
  binary,
  `#!/usr/bin/env node
import fs from 'node:fs';
const output = process.argv[process.argv.indexOf('-of') + 1];
fs.writeFileSync(output + '.txt', 'locally dictated text');
`,
  { mode: 0o755 },
);
const mock = await mockOllama();
const app = await createApp({
  dataDir: path.join(directory, "data"),
  endpoint: mock.url,
  port: 0,
  refresh: false,
  speechBinary: binary,
});
await app.ollama.refresh();
await fs.writeFile(app.speech.modelPath("base.en"), "test weights");
app.store.data.settings.onboarded = true;
app.store.touch();
const task = app.store.addTask({ model: "test-model:latest" });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript((taskId) => {
  localStorage.setItem("ember.task", taskId);
  const track = { stop() {} };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  });
  class TestAudioContext {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      const processor = {
        onaudioprocess: null,
        connect() {
          setTimeout(
            () =>
              processor.onaudioprocess?.({
                inputBuffer: {
                  getChannelData: () => new Float32Array(4096).fill(0.1),
                },
              }),
            20,
          );
        },
        disconnect() {},
      };
      return processor;
    }
    async close() {}
  }
  window.AudioContext = TestAudioContext;
}, task.id);
try {
  await page.goto(`${app.url}/?task=${task.id}`);
  await page.locator(".task-link").filter({ hasText: "New task" }).click();
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("Before after");
  await message.evaluate((element) => element.setSelectionRange(6, 6));
  await page.getByRole("button", { name: "Start dictation" }).click();
  await page.getByRole("button", { name: "Stop dictation" }).waitFor();
  await page.waitForTimeout(60);
  await page.getByRole("button", { name: "Stop dictation" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Message"]')?.value ===
      "Before locally dictated text after",
  );
  assert.equal(
    await message.inputValue(),
    "Before locally dictated text after",
  );
  await page.getByRole("button", { name: "Start dictation" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Start dictation" })
      .evaluate((button) => button.classList.contains("recording")),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Start dictation" })
      .evaluate((button) =>
        button.nextElementSibling?.getAttribute("aria-label"),
      ),
    "Send message",
  );
  if (process.env.EMBER_DICTATION_SCREENSHOT) {
    await page.screenshot({
      path: process.env.EMBER_DICTATION_SCREENSHOT,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.screenshot({
      path: process.env.EMBER_DICTATION_SETTINGS_SCREENSHOT,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Dictation UI passed: record, local WAV transcription, cursor insertion, and review before send.",
  );
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(directory, { recursive: true, force: true });
}
