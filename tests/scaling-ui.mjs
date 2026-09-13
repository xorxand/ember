import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { git } from "../server/workspaces.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-scaling-ui-"));
const root = path.join(dir, "repo");
await fs.mkdir(root);
await fs.writeFile(path.join(root, "README.md"), "# Scaling UI project\n");
await fs.writeFile(
  path.join(root, "module.js"),
  'export function scaleWidget() { return "SCALING_NEEDLE"; }\n',
);
await git(root, ["init", "-b", "main"]);
await git(root, ["add", "."]);
await git(root, [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "-m",
  "initial",
]);
const mock = await mockOllama();
const app = await createApp({
  dataDir: path.join(dir, "data"),
  port: 0,
  endpoint: mock.url,
  refresh: false,
});
await app.ollama.refresh();
app.store.data.settings.onboarded = true;
app.store.data.projects.push({ id: "p", name: "Scale repo", path: root });
const task = app.store.addTask({
  projectId: "p",
  mode: "agent",
  title: "Isolated task",
});
const long = app.store.addTask({ title: "Long history" });
for (let i = 0; i < 140; i++)
  long.messages.push({
    id: "history-" + i,
    role: i % 2 ? "assistant" : "user",
    content: "Historical message " + i,
  });
app.store.touch();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.url);
  await page
    .locator(".task-table-row")
    .filter({ hasText: "Long history" })
    .click();
  await page.getByRole("button", { name: "Load earlier messages" }).waitFor();
  assert.equal(await page.locator(".message").count(), 60);
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await page.getByText("Historical message 20", { exact: true }).waitFor();
  assert.equal(await page.locator(".message").count(), 120);
  await page.locator(".task-link").filter({ hasText: "Isolated task" }).click();
  await page.getByLabel("Message", { exact: true }).fill("write a file");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Inspect change" }).waitFor();
  await page.getByRole("button", { name: "Inspect change" }).click();
  await page
    .locator(".change-actions")
    .getByRole("button", { name: "Apply change" })
    .click();
  await until(() => task.status === "complete");
  await assert.rejects(fs.access(path.join(root, "hello.txt")));
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByLabel("Search repository", { exact: true })
    .fill("SCALING_NEEDLE");
  await page
    .locator(".repository-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await page.locator(".search-result").filter({ hasText: "module.js" }).click();
  await page
    .locator(".search-excerpt pre")
    .filter({ hasText: "scaleWidget" })
    .waitFor();
  await page.getByRole("button", { name: /^changes/ }).click();
  await page.getByRole("button", { name: "Review all changes" }).click();
  await page.getByText("Inspect complete patch", { exact: true }).click();
  await page
    .locator(".worktree-review details pre")
    .filter({ hasText: "Hello from the agent" })
    .waitFor();
  await page.getByRole("button", { name: "Apply to original project" }).click();
  await until(() => Boolean(task.workspace.appliedAt));
  assert.equal(
    await fs.readFile(path.join(root, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Scaling UI passed: paginated history; Git isolation; repository search and excerpts; reviewed apply to original.",
  );
} catch (e) {
  await page.screenshot({
    path: path.join(os.tmpdir(), "ember-scaling-ui-failure.png"),
  });
  throw e;
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
}
