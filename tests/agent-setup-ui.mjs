import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-agent-setup-"));
const mock = await mockOllama();
const app = await createApp({
  dataDir: path.join(dir, "data"),
  port: 0,
  endpoint: mock.url,
  refresh: false,
});
await app.ollama.refresh();
app.store.data.settings.onboarded = true;
const task = app.store.addTask({ title: "Existing chat" });
app.agent.enqueue(task.id, "count to ten");
await until(() => task.status === "complete");
const saved = JSON.stringify(task.messages);
const projectPath = path.join(dir, "project");
await fs.mkdir(projectPath);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.url);
  await page
    .locator(".task-table-row")
    .filter({ hasText: "Existing chat" })
    .click();
  await page.getByLabel("Message", { exact: true }).fill("write a file");
  assert.equal(
    await page.getByLabel("Task mode").locator('option[value="agent"]').count(),
    1,
  );
  await page
    .getByText("Chat only · no file edits or commands", { exact: true })
    .waitFor();
  await page.getByLabel("Task mode").selectOption("agent");
  let modal = page.getByRole("dialog", { name: "Enable Agent", exact: true });
  await modal.waitFor();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Task mode").inputValue(), "chat");
  assert.equal(task.projectId, null);
  await page.getByRole("button", { name: "Enable Agent", exact: true }).click();
  await modal
    .getByRole("button", { name: "Add a project folder", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Countdown project");
  await page.getByLabel("Project folder", { exact: true }).fill(projectPath);
  await page
    .getByRole("dialog", { name: "Add a project", exact: true })
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await modal.waitFor();
  await modal
    .getByRole("button", { name: "Enable Agent", exact: true })
    .click();
  await until(() => task.mode === "agent");
  assert.equal(task.projectId, app.store.data.projects[0].id);
  assert.equal(JSON.stringify(task.messages), saved);
  assert.equal(
    await page.getByLabel("Message", { exact: true }).inputValue(),
    "write a file",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect change", exact: true })
    .click();
  await assert.rejects(fs.access(path.join(projectPath, "hello.txt")));
  await page
    .locator(".change-actions")
    .getByRole("button", { name: "Apply change", exact: true })
    .click();
  await until(() => task.status === "complete");
  assert.equal(
    await fs.readFile(path.join(projectPath, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  await page.getByLabel("Task mode").selectOption("chat");
  await until(() => task.mode === "chat");
  await page.getByLabel("Task mode").selectOption("agent");
  await until(() => task.mode === "agent");
  assert.equal(await page.getByRole("dialog").count(), 0);
  const other = app.store.addTask({ title: "Another chat" });
  await page.reload();
  await page
    .locator(".task-table-row")
    .filter({ hasText: "Another chat" })
    .click();
  await page.getByLabel("Task mode").selectOption("agent");
  await modal.getByLabel("Agent project").selectOption(task.projectId);
  await modal
    .getByRole("button", { name: "Enable Agent", exact: true })
    .click();
  await until(() => other.mode === "agent");
  assert.equal(other.projectId, task.projectId);
  await page.getByLabel("Message", { exact: true }).fill("response-only");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await until(() => other.status === "complete");
  await page
    .getByRole("status")
    .filter({ hasText: "Response only: no tools ran" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Agent setup UI passed: visible mode, cancel, add folder, preserve history/draft, approved file write, existing project selection, and mode switching.",
  );
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
}
