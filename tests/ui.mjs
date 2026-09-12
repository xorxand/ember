import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-ui-"));
const mock = await mockOllama();
const app = await createApp({
  dataDir: path.join(dir, "data"),
  port: 0,
  endpoint: mock.url,
  refresh: false,
});
await app.ollama.refresh();
app.store.data.settings.onboarded = true;
app.store.data.catalog = {
  fetchedAt: new Date().toISOString(),
  models: [
    {
      name: "test-model",
      description:
        "A reliable local model for test conversations and tool use.",
      capabilities: ["tools", "thinking"],
      sizes: ["1b", "4b"],
      pulls: "1.2M",
      updated: "1 day ago",
    },
    {
      name: "vision-model",
      description: "Local image understanding.",
      capabilities: ["vision"],
      sizes: ["4b"],
      pulls: "400K",
    },
  ],
};
app.catalog.tags = async (family) => [
  {
    name: family + ":latest",
    size: 1e9,
    sizeLabel: "1.0 GB",
    context: "32K",
    cloud: false,
  },
];
app.catalog.refresh = async () => app.store.data.catalog;
app.catalog.manifest = async () => ({ digest: "abc", size: 1e9 });
app.store.touch();
const projectPath = path.join(dir, "project");
await fs.mkdir(projectPath);
await fs.writeFile(path.join(projectPath, "README.md"), "# UI test project\n");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
try {
  await page.goto(app.url);
  await page.getByRole("heading", { name: "What will you build?" }).waitFor();
  checks.push("Workspace loads");
  await page.locator(".main-nav button").filter({ hasText: "Models" }).click();
  await page.getByLabel("Search model library").fill("vision");
  assert.equal(await page.locator(".model-card").count(), 1);
  await page.getByLabel("Search model library").fill("");
  await page.locator(".model-card").filter({ hasText: "vision-model" }).click();
  await page
    .getByRole("button", { name: "Download model", exact: true })
    .click();
  await page.getByRole("tab", { name: /Downloads/ }).waitFor();
  await until(() => app.store.data.downloads[0]?.status === "complete");
  await page
    .locator(".download-card")
    .filter({ hasText: "Ready to use" })
    .waitFor();
  checks.push("Catalog search, variant selection, real API download queue");
  await page.getByRole("tab", { name: /Installed/ }).click();
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByText("✓ Up to date").first().waitFor();
  checks.push("Installed models and update checks");
  await page
    .getByRole("button", { name: "Remove vision-model:latest", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep model" }).click();
  assert.ok(mock.models.some((m) => m.name === "vision-model:latest"));
  checks.push("Delete confirmation keeps model on cancel");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("UI project");
  await page.getByLabel("Project folder", { exact: true }).fill(projectPath);
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "Let’s move this project forward." })
    .waitFor();
  checks.push("Project creation");
  await page
    .locator(".task-list-header")
    .getByRole("button", { name: "New task" })
    .click();
  await page.getByLabel("Message", { exact: true }).fill("write a file");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Inspect change" }).waitFor();
  await assert.rejects(fs.access(path.join(projectPath, "hello.txt")));
  await page.getByRole("button", { name: "Inspect change" }).click();
  await page.locator(".diff .added").first().waitFor();
  await page
    .locator(".change-actions")
    .getByRole("button", { name: "Apply change" })
    .click();
  await until(() => app.store.data.tasks[0].status === "complete");
  assert.equal(
    await fs.readFile(path.join(projectPath, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  checks.push(
    "Agent streaming, proposal, diff review, approval and continuation",
  );
  await page.getByRole("button", { name: "terminal", exact: true }).click();
  await page
    .getByLabel("Terminal command", { exact: true })
    .fill("printf UI_TERMINAL_OK");
  await page.getByRole("button", { name: "Run terminal command" }).click();
  await page
    .locator(".terminal-block pre")
    .filter({ hasText: "UI_TERMINAL_OK" })
    .waitFor();
  checks.push("Project terminal command and captured output");
  await page.getByRole("button", { name: "files", exact: true }).click();
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page
    .locator(".file-content")
    .filter({ hasText: "# UI test project" })
    .waitFor();
  checks.push("Project file browser");
  await page.getByRole("button", { name: "Close project panel" }).click();
  await page.getByRole("button", { name: "Archive task" }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page
    .locator(".task-table-row")
    .filter({ hasText: "write a file" })
    .waitFor();
  await page.getByText("Restore", { exact: true }).click();
  checks.push("Archive and restore task");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Context length", { exact: true }).selectOption("4096");
  await page.getByRole("button", { name: "Save settings" }).click();
  await until(() => app.store.data.settings.contextLength === 4096);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  checks.push("Settings persistence and light theme");
  await page.reload();
  await page.getByRole("heading", { name: "What will you build?" }).waitFor();
  assert.equal(await page.locator(".task-table-row").count(), 1);
  checks.push("Reload retains projects and tasks");
  await page.setViewportSize({ width: 1000, height: 760 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push("Narrow desktop layout without horizontal overflow");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, browserErrors: errors },
      null,
      2,
    ),
  );
} catch (e) {
  await fs.mkdir(path.join(os.tmpdir(), "ember-test-artifacts"), {
    recursive: true,
  });
  await page.screenshot({
    path: path.join(os.tmpdir(), "ember-test-artifacts", "ui-failure.png"),
  });
  console.error("Browser errors:", errors);
  throw e;
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
}
