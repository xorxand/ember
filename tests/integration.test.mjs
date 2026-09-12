import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-api-"));
  const mock = await mockOllama();
  const app = await createApp({
    dataDir: path.join(dir, "data"),
    port: 0,
    endpoint: mock.url,
    refresh: false,
  });
  await app.ollama.refresh();
  const projectPath = path.join(dir, "project");
  await fs.mkdir(projectPath);
  const call = async (route, data, extra = {}) => {
    const res = await fetch(app.url + "/api/" + route, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "x-ember-token": app.token,
        "Content-Type": "application/json",
        ...extra,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: res.status, data: await res.json() };
  };
  t.after(async () => {
    await app.close();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { app, mock, dir, call, projectPath };
}
test("API requires token and same-origin requests, and keeps workspace persistent", async (t) => {
  const { app, call } = await fixture(t);
  const unauthorized = await fetch(app.url + "/api/state");
  assert.equal(unauthorized.status, 401);
  assert.equal(
    (await call("state", undefined, { Origin: "https://evil.example" })).status,
    403,
  );
  const wrongHost = await new Promise((resolve) => {
    const req = http.get(
      app.url + "/api/state",
      { headers: { host: "evil.example", "x-ember-token": app.token } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
  });
  assert.equal(wrongHost, 403);
  const response = await call("tasks", { title: "A real task" });
  assert.equal(response.status, 200);
  assert.equal((await call("state")).data.tasks[0].title, "A real task");
  assert.equal(
    JSON.parse(await fs.readFile(app.store.file)).tasks[0].title,
    "A real task",
  );
});
test("streaming chat, task queue, cancellation, and model mutation guards", async (t) => {
  const { app, call } = await fixture(t);
  const first = (await call("tasks", {})).data;
  const second = (await call("tasks", {})).data;
  assert.equal(
    (await call("tasks/send", { id: first.id, content: "slow please" })).status,
    200,
  );
  await until(() =>
    app.store
      .task(first.id)
      .messages.some((m) => m.role === "assistant" && m.content),
  );
  await call("tasks/send", { id: second.id, content: "hello" });
  assert.equal(app.store.task(second.id).status, "queued");
  assert.equal(
    (await call("models/delete", { name: "test-model:latest" })).status,
    400,
  );
  assert.equal(
    (await call("downloads", { name: "test-model:latest" })).status,
    400,
  );
  assert.equal(
    (await call("tasks/update", { id: first.id, model: "other" })).status,
    400,
  );
  await call("tasks/stop", { id: first.id });
  await until(
    () =>
      app.store.task(first.id).status === "stopped" &&
      app.store.task(second.id).status === "complete",
  );
  assert.match(app.store.task(second.id).messages.at(-1).content, /Hello from/);
});
test("agent write is reviewable, executes only on approval, and then continues", async (t) => {
  const { app, call, projectPath } = await fixture(t);
  const project = (
    await call("projects", { path: projectPath, name: "Fixture" })
  ).data;
  const task = (await call("tasks", { projectId: project.id, mode: "agent" }))
    .data;
  await call("tasks/send", { id: task.id, content: "write a file" });
  await until(() => app.store.task(task.id).status === "approval");
  await assert.rejects(fs.access(path.join(projectPath, "hello.txt")));
  const approval = app.store.task(task.id).approvals[0];
  assert.equal(approval.before, null);
  assert.equal(approval.content, "Hello from the agent.\n");
  await call("approvals", { id: approval.id, approve: true });
  await until(() => app.store.task(task.id).status === "complete");
  assert.equal(
    await fs.readFile(path.join(projectPath, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  assert.equal(approval.status, "applied");
  assert.equal(
    (await call("approvals", { id: approval.id, approve: true })).status,
    400,
  );
});
test("rejected proposals and traversal tool calls never write a file", async (t) => {
  const { app, call, projectPath } = await fixture(t);
  const p = (await call("projects", { path: projectPath })).data;
  const task = (await call("tasks", { projectId: p.id, mode: "agent" })).data;
  await call("tasks/send", { id: task.id, content: "write a file" });
  await until(() => app.store.task(task.id).status === "approval");
  await call("approvals", {
    id: app.store.task(task.id).approvals[0].id,
    approve: false,
  });
  await until(() => app.store.task(task.id).status === "complete");
  await assert.rejects(fs.access(path.join(projectPath, "hello.txt")));
  const escape = (await call("tasks", { projectId: p.id, mode: "agent" })).data;
  await call("tasks/send", { id: escape.id, content: "escape write" });
  await until(() => app.store.task(escape.id).status === "complete");
  assert.match(
    app.store.task(escape.id).messages.find((m) => m.role === "tool").content,
    /Error:/,
  );
  await assert.rejects(fs.access(path.join(projectPath, "..", "escape.txt")));
});
test("agent command requires approval and captures actual output", async (t) => {
  const { app, call, projectPath } = await fixture(t);
  const p = (await call("projects", { path: projectPath })).data;
  const task = (await call("tasks", { projectId: p.id, mode: "agent" })).data;
  await call("tasks/send", { id: task.id, content: "run a command" });
  await until(() => app.store.task(task.id).status === "approval");
  const a = app.store.task(task.id).approvals[0];
  assert.equal(a.output, undefined);
  await call("approvals", { id: a.id, approve: true });
  await until(() => app.store.task(task.id).status === "complete");
  assert.equal(a.output, "agent-command-ok");
  assert.equal(a.exitCode, 0);
});
test("download queue streams progress, pauses, resumes, and reports errors", async (t) => {
  const { app, call } = await fixture(t);
  const job = (await call("downloads", { name: "new-model" })).data;
  await until(
    () => app.store.data.downloads.find((d) => d.id === job.id).completed > 0,
  );
  await call("downloads/pause", { id: job.id });
  await until(() => app.downloads.active === null);
  assert.equal(app.store.data.downloads[0].status, "paused");
  await call("downloads/resume", { id: job.id });
  await until(() => app.store.data.downloads[0].status === "complete");
  assert.ok(
    app.ollama.status.models.some((m) => m.name === "new-model:latest"),
  );
  await call("downloads", { name: "fail" });
  await until(() => app.store.data.downloads[0].status === "failed");
  assert.match(app.store.data.downloads[0].error, /deliberate/);
  assert.equal(
    (await call("downloads", { name: "anything:cloud" })).status,
    400,
  );
});
test("invalid settings are atomic and do not change the working endpoint", async (t) => {
  const { app, call } = await fixture(t);
  const before = { ...app.store.data.settings };
  const result = await call("settings", {
    endpoint: "http://localhost:1",
    contextLength: -1,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(app.store.data.settings, before);
});
test("stale approved write fails visibly and preserves external edits", async (t) => {
  const { app, call, projectPath } = await fixture(t);
  await fs.writeFile(path.join(projectPath, "hello.txt"), "original");
  const p = (await call("projects", { path: projectPath })).data;
  const task = (await call("tasks", { projectId: p.id, mode: "agent" })).data;
  await call("tasks/send", { id: task.id, content: "write a file" });
  await until(() => app.store.task(task.id).status === "approval");
  const a = app.store.task(task.id).approvals[0];
  await fs.writeFile(path.join(projectPath, "hello.txt"), "edited by user");
  await call("approvals", { id: a.id, approve: true });
  await until(() => app.store.task(task.id).status === "complete");
  assert.equal(a.status, "failed");
  assert.match(a.error, /changed since/);
  assert.equal(
    await fs.readFile(path.join(projectPath, "hello.txt"), "utf8"),
    "edited by user",
  );
});
test("stopping a pending approval cannot execute the proposal and permits another turn", async (t) => {
  const { app, call, projectPath } = await fixture(t);
  const p = (await call("projects", { path: projectPath })).data;
  const task = (await call("tasks", { projectId: p.id, mode: "agent" })).data;
  await call("tasks/send", { id: task.id, content: "write a file" });
  await until(() => app.store.task(task.id).status === "approval");
  const a = app.store.task(task.id).approvals[0];
  await call("tasks/stop", { id: task.id });
  await until(() => app.store.task(task.id).status === "stopped");
  assert.equal(a.status, "cancelled");
  assert.equal(
    (await call("approvals", { id: a.id, approve: true })).status,
    400,
  );
  await assert.rejects(fs.access(path.join(projectPath, "hello.txt")));
  await call("tasks/send", {
    id: task.id,
    content: "Continue with a summary only",
  });
  await until(() => app.store.task(task.id).status === "complete");
});
