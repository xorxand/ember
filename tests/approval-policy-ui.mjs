import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-policy-ui-"));
const mock = await mockOllama();
const app = await createApp({
  dataDir: path.join(dir, "data"),
  port: 0,
  endpoint: mock.url,
  refresh: false,
});
await app.ollama.refresh();
app.store.data.settings.onboarded = true;
const folder = path.join(dir, "project");
await fs.mkdir(folder);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const taskModal = page.getByRole("dialog", {
  name: "Task approvals",
  exact: true,
});
async function newTask() {
  const count = app.store.data.tasks.length;
  await page
    .getByRole("button", { name: "New task in Policy project", exact: true })
    .click();
  await until(() => app.store.data.tasks.length === count + 1);
  await page.getByRole("heading", { name: "New task", exact: true }).waitFor();
  await page.getByLabel("Task approvals", { exact: true }).waitFor();
  return app.store.data.tasks[0];
}
async function mode(value) {
  await page.getByLabel("Task approvals", { exact: true }).click();
  await taskModal
    .getByLabel("Approval mode", { exact: true })
    .selectOption(value);
  await taskModal
    .getByRole("button", { name: "Save approvals", exact: true })
    .click();
  await taskModal.waitFor({ state: "hidden" });
}
async function send(message) {
  await page.getByLabel("Message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
try {
  await page.goto(app.url);
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const projectModal = page.getByRole("dialog", {
    name: "Add a project",
    exact: true,
  });
  await projectModal
    .getByLabel("Project name", { exact: true })
    .fill("Policy project");
  await projectModal.getByLabel("Project folder", { exact: true }).fill(folder);
  assert.equal(
    await projectModal
      .getByLabel("Approval mode", { exact: true })
      .inputValue(),
    "ask",
  );
  await projectModal
    .getByLabel("Approval mode", { exact: true })
    .selectOption("risky");
  await projectModal
    .getByLabel("Trusted commands", { exact: true })
    .fill("printf agent-command-ok");
  await projectModal
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  const write = await newTask();
  assert.match(
    await page.getByLabel("Task approvals", { exact: true }).innerText(),
    /risky or unknown/,
  );
  await send("write a file");
  await until(() => write.status === "complete");
  assert.equal(
    await fs.readFile(path.join(folder, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  await page
    .locator(".tool-result summary")
    .filter({ hasText: "Auto-approved" })
    .waitFor();
  const ask = await newTask();
  await mode("ask");
  await send("command please");
  await page
    .getByRole("button", { name: "Run command", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Task approvals", { exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await until(() => ask.status === "complete");
  assert.equal(ask.approvals[0].status, "rejected");
  const always = await newTask();
  await page.getByLabel("Task approvals", { exact: true }).click();
  await taskModal
    .getByLabel("Approval mode", { exact: true })
    .selectOption("always");
  await taskModal
    .getByText(/Shell commands run with your user permissions/)
    .waitFor();
  await taskModal
    .getByRole("button", { name: "Save approvals", exact: true })
    .click();
  await taskModal.waitFor({ state: "hidden" });
  await send("command please");
  await until(() => always.status === "complete");
  assert.equal(always.approvals[0].approvalSource, "automatic");
  assert.equal(always.approvals[0].exitCode, 0);
  await mode("inherit");
  assert.equal(always.approvalPolicy, null);
  const trusted = await newTask();
  await send("command please");
  await until(() => trusted.status === "complete");
  assert.equal(trusted.approvals[0].policyMode, "risky");
  assert.equal(trusted.approvals[0].approvalSource, "automatic");
  await page
    .locator(".project-name")
    .filter({ hasText: "Policy project" })
    .click();
  await page
    .getByRole("button", { name: "Project settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Project settings",
    exact: true,
  });
  assert.equal(
    await settings.getByLabel("Trusted commands", { exact: true }).inputValue(),
    "printf agent-command-ok",
  );
  await settings
    .getByLabel("Approval mode", { exact: true })
    .selectOption("ask");
  await settings
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page.reload();
  const inherited = await newTask();
  assert.match(
    await page.getByLabel("Task approvals", { exact: true }).innerText(),
    /Ask every time/,
  );
  await page.getByLabel("Task approvals", { exact: true }).click();
  await taskModal
    .getByLabel("Approval mode", { exact: true })
    .selectOption("risky");
  await taskModal
    .getByLabel("Trusted commands", { exact: true })
    .fill("go build -o countdown main.go\ngo test ./...");
  if (process.env.EMBER_POLICY_SCREENSHOT)
    await page.screenshot({ path: process.env.EMBER_POLICY_SCREENSHOT });
  await taskModal.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(inherited.approvalPolicy, null);
  assert.deepEqual(errors, []);
  console.log(
    "Approval UI passed: project defaults, task overrides, inheritance reset, automatic write/command audit, manual rejection, active-task guard, reload persistence, and cancelled edits.",
  );
} finally {
  await browser.close();
  await app.close();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
}
