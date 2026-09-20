import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-timing-ui-"));
const mock = await mockOllama();
const app = await createApp({
  dataDir: dir,
  port: 0,
  endpoint: mock.url,
  refresh: false,
});
await app.ollama.refresh();
app.store.data.settings.onboarded = true;
const task = app.store.addTask({ title: "Timing check" });
task.messages.push(
  {
    id: "legacy-user",
    role: "user",
    content: "Earlier question",
    createdAt: "2026-09-13T12:00:00Z",
  },
  {
    id: "legacy-answer",
    role: "assistant",
    content: "Earlier reply",
    createdAt: "2026-09-13T12:00:01Z",
  },
);
app.store.touch({ taskId: task.id });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "America/New_York",
});
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.url);
  await page
    .locator(".task-table-row")
    .filter({ hasText: "Timing check" })
    .click();
  assert.equal(await page.getByLabel("Response timing").count(), 0);
  await page.getByLabel("Message", { exact: true }).fill("slow please");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Response timing")
    .getByText("Responding…", { exact: true })
    .waitFor();
  await until(() => task.status === "complete");
  const timing = page.getByLabel("Response timing");
  await timing.getByText(/Response finished/).waitFor();
  assert.match(await timing.innerText(), /elapsed/);
  const dates = await timing
    .locator("time")
    .evaluateAll((nodes) => nodes.map((n) => n.dateTime));
  assert.deepEqual(dates, [
    task.messages.at(-1).timing.startedAt,
    task.messages.at(-1).timing.firstResponseAt,
    task.messages.at(-1).timing.finishedAt,
  ]);
  const saved = await timing.innerText();
  if (process.env.EMBER_TIMING_SCREENSHOT)
    await page.screenshot({ path: process.env.EMBER_TIMING_SCREENSHOT });
  await page.reload();
  await page
    .locator(".task-table-row")
    .filter({ hasText: "Timing check" })
    .click();
  await page
    .getByLabel("Response timing")
    .getByText(/Response finished/)
    .waitFor();
  assert.equal(await page.getByLabel("Response timing").innerText(), saved);
  await page.getByLabel("Message", { exact: true }).fill("slow please again");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Response timing")
    .last()
    .getByText("Responding…", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Stop task", exact: true }).click();
  await until(() => task.status === "stopped");
  await page
    .getByLabel("Response timing")
    .last()
    .getByText(/Stopped/)
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Timing UI passed: legacy messages, live response timer, timestamps in local timezone, completion, reload persistence, and cancellation.",
  );
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
}
