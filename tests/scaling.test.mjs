import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Workspaces, git } from "../server/workspaces.mjs";
import { Search } from "../server/search.mjs";
import { diffState, applyPatches } from "../shared/state-patches.js";
import { createApp } from "../server/index.mjs";
import { mockOllama, until } from "./mock-ollama.mjs";
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "ember-scale-"));
async function repo(dir) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ["init", "-b", "main"]);
  await fs.writeFile(path.join(dir, "README.md"), "Initial content\n");
  await git(dir, ["add", "."]);
  await git(dir, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "initial",
  ]);
}
test("legacy migration is transactional, retains backup, lazily loads history, and supports full-text search and paging", async (t) => {
  const dir = await temp();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tasks = Array.from({ length: 120 }, (_, i) => ({
    id: "task-" + i,
    title: "Task " + i,
    status: "complete",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    messages: Array.from({ length: 240 }, (_, j) => ({
      id: `m-${i}-${j}`,
      role: j % 2 ? "assistant" : "user",
      content:
        `${j === 1 ? "uniqueneedle " : ""}message ${j} ` + "x".repeat(200),
    })),
    approvals: [],
  }));
  const legacy = {
    version: 1,
    tasks,
    projects: [],
    settings: { endpoint: "http://localhost:11434" },
    downloads: [],
  };
  await fs.writeFile(path.join(dir, "workspace.json"), JSON.stringify(legacy));
  const store = new Store(dir);
  t.after(() => store.close());
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM messages").get().n,
    28800,
  );
  assert.equal(store.details.size, 0);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(dir, "workspace.json.pre-sqlite")))
      .tasks.length,
    120,
  );
  assert.equal(store.summaries().items.length, 100);
  assert.equal(store.summaries({ offset: 100 }).items.length, 20);
  assert.equal(store.summaries({ query: "uniqueneedle" }).total, 120);
  assert.ok(Buffer.byteLength(JSON.stringify(store.summaries())) < 60000);
  const detail = store.detail("task-0");
  assert.equal(detail.messages.length, 60);
  assert.equal(detail.hasOlderMessages, true);
  const page = store.messagePage("task-0", detail.messages[0].id);
  assert.equal(page.messages.length, 60);
  assert.equal(
    new Set([...page.messages, ...detail.messages].map((m) => m.id)).size,
    120,
  );
  // An edit to one streamed answer must not rewrite other messages.
  store.db.exec(
    "CREATE TABLE audit(id TEXT);CREATE TRIGGER audit_update AFTER UPDATE ON messages BEGIN INSERT INTO audit VALUES(new.id);END;",
  );
  const task = store.task("task-0");
  task.messages.at(-1).content += " next token";
  store.touch({ taskId: task.id });
  assert.deepEqual(
    store.db
      .prepare("SELECT id FROM audit")
      .all()
      .map((r) => r.id),
    ["m-0-239"],
  );
});
test("incremental patches preserve arrays and deletions and append only streamed characters", () => {
  const before = {
    tasks: [{ id: "one", messages: [{ id: "m", content: "a".repeat(50000) }] }],
    settings: { old: true },
  };
  const next = structuredClone(before);
  next.tasks[0].messages[0].content += "hello";
  delete next.settings.old;
  next.tasks[0].messages.push({ id: "n", content: "new" });
  const patches = diffState(before, next);
  assert.ok(JSON.stringify(patches).length < 350);
  assert.deepEqual(applyPatches(before, patches), next);
  assert.equal(before.tasks[0].messages[0].content.length, 50000);
});
test("Git tasks have distinct branches, preserve source edits, review committed and untracked changes, and reject stale review", async (t) => {
  const dir = await temp();
  const root = path.join(dir, "repo");
  await repo(root);
  const store = new Store(path.join(dir, "data"));
  const workspaces = new Workspaces(store);
  t.after(async () => {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  store.data.projects.push({ id: "p", name: "Repo", path: root });
  const p = store.project("p");
  await fs.writeFile(
    path.join(root, "README.md"),
    "User has uncommitted edits\n",
  );
  const first = store.addTask({ projectId: "p", mode: "agent" }),
    second = store.addTask({ projectId: "p", mode: "agent" });
  await Promise.all([
    workspaces.ensure(first, p),
    workspaces.ensure(second, p),
  ]);
  assert.notEqual(first.workspace.path, second.workspace.path);
  assert.equal(
    await fs.readFile(path.join(first.workspace.path, "README.md"), "utf8"),
    "Initial content\n",
  );
  await fs.writeFile(
    path.join(first.workspace.path, "feature.txt"),
    "Feature one\n",
  );
  await fs.writeFile(
    path.join(second.workspace.path, "feature.txt"),
    "Feature two\n",
  );
  const review = await workspaces.review(first);
  assert.match(review.patch, /Feature one/);
  await assert.rejects(
    workspaces.apply(first, review.digest),
    /uncommitted changes/,
  );
  await git(root, ["restore", "README.md"]);
  await fs.writeFile(
    path.join(first.workspace.path, "feature.txt"),
    "Changed after review\n",
  );
  await assert.rejects(
    workspaces.apply(first, review.digest),
    /changed since review/,
  );
  const updated = await workspaces.review(first);
  await workspaces.apply(first, updated.digest);
  assert.equal(
    await fs.readFile(path.join(root, "feature.txt"), "utf8"),
    "Changed after review\n",
  );
  assert.equal(
    await fs.readFile(path.join(second.workspace.path, "feature.txt"), "utf8"),
    "Feature two\n",
  );
});
test("repository search honors ignore and secret exclusions, does not follow symlinks, returns symbols and bounded excerpts", async (t) => {
  const dir = await temp();
  const root = path.join(dir, "repo");
  await repo(root);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, "ignored"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await fs.writeFile(
    path.join(root, "src", "module.js"),
    'export function findWidget() {\n return "needle";\n}\n',
  );
  await fs.writeFile(path.join(root, "ignored", "x.txt"), "needle");
  await fs.writeFile(path.join(root, ".env"), "needle");
  await fs.writeFile(path.join(dir, "outside"), "needle");
  await fs.symlink(path.join(dir, "outside"), path.join(root, "link"));
  const search = new Search();
  const result = await search.search(root, { query: "needle" });
  assert.deepEqual(
    result.matches.map((m) => m.path),
    ["src/module.js"],
  );
  const files = await search.search(root, { query: "module", kind: "files" });
  assert.equal(files.matches[0].path, "src/module.js");
  const symbols = await search.search(root, {
    query: "Widget",
    kind: "symbols",
  });
  assert.equal(symbols.matches[0].symbol, "findWidget");
  const excerpt = await search.excerpt(root, "src/module.js", 2, 2);
  assert.equal(excerpt.content, '2:  return "needle";');
  await assert.rejects(search.excerpt(root, "../outside"), /allowed|escape/);
});
test("two Git agent tasks can wait for review concurrently and write only to their own worktrees", async (t) => {
  const dir = await temp();
  const root = path.join(dir, "repo");
  await repo(root);
  const mock = await mockOllama();
  const app = await createApp({
    dataDir: path.join(dir, "data"),
    port: 0,
    endpoint: mock.url,
    refresh: false,
  });
  await app.ollama.refresh();
  app.store.data.settings.concurrency = 2;
  app.store.data.projects.push({ id: "p", name: "Repo", path: root });
  t.after(async () => {
    await app.close();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const a = app.store.addTask({ projectId: "p", mode: "agent" }),
    b = app.store.addTask({ projectId: "p", mode: "agent" });
  app.agent.enqueue(a.id, "write a file");
  app.agent.enqueue(b.id, "write another file");
  await until(() => a.status === "approval" && b.status === "approval");
  app.agent.resolveApproval(a.approvals[0].id, true);
  app.agent.resolveApproval(b.approvals[0].id, true);
  await until(() => a.status === "complete" && b.status === "complete");
  await assert.rejects(fs.access(path.join(root, "hello.txt")));
  assert.equal(
    await fs.readFile(path.join(a.workspace.path, "hello.txt"), "utf8"),
    "Hello from the agent.\n",
  );
  assert.notEqual(a.workspace.path, b.workspace.path);
});
