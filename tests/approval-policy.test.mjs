import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  normalizeApprovalPolicy,
  effectiveApprovalPolicy,
  approvalDecision,
  ordinaryProjectWrite,
} from "../shared/approval-policy.js";
import { inspectWrite, applyWrite } from "../server/projects.mjs";
import { Store } from "../server/store.mjs";

test("approval policy defaults, inheritance, invalid input, and exact command matching", () => {
  assert.equal(effectiveApprovalPolicy({}, {}).mode, "ask");
  const project = { approvalPolicy: { mode: "always", trustedCommands: [] } };
  assert.equal(effectiveApprovalPolicy({}, project).mode, "always");
  assert.equal(
    effectiveApprovalPolicy({ approvalPolicy: { mode: "ask" } }, project).mode,
    "ask",
  );
  assert.equal(
    effectiveApprovalPolicy({ approvalPolicy: { mode: "bogus" } }, project)
      .mode,
    "ask",
  );
  for (const invalid of [
    false,
    [],
    {},
    { mode: "bogus" },
    { mode: "always", trustedCommands: ["line\nnext"] },
    { mode: "risky", trustedCommands: Array(41).fill("true") },
  ])
    assert.throws(() => normalizeApprovalPolicy(invalid));
  const policy = normalizeApprovalPolicy({
    mode: "risky",
    trustedCommands: [" printf ok ", "printf ok"],
  });
  assert.deepEqual(policy.trustedCommands, ["printf ok"]);
  assert.equal(
    approvalDecision(policy, "command", { command: " printf ok " }).automatic,
    true,
  );
  for (const command of [
    "printf okay",
    "printf ok; rm file",
    "printf ok && pwd",
    "printf $(pwd)",
    "printf ok\npwd",
  ])
    assert.equal(
      approvalDecision(policy, "command", { command }).automatic,
      false,
    );
  assert.equal(
    approvalDecision({ mode: "ask" }, "write", { path: "main.go" }).automatic,
    false,
  );
  assert.equal(
    approvalDecision({ mode: "always" }, "command", {
      command: "unrecognized-command",
    }).automatic,
    true,
  );
});
test("middle policy prompts for scripts, configuration, executable/symlink targets and unknown types", async () => {
  for (const file of ["main.go", "src/app.tsx", "README.md", "styles/main.css"])
    assert.equal(ordinaryProjectWrite({ path: file }), true, file);
  for (const file of [
    "scripts/main.go",
    ".github/workflow.yml",
    "package.json",
    "vite.config.js",
    "setup.py",
    "build.rs",
    "run.sh",
    "unknown.xyz",
    "../main.go",
    "/absolute.go",
  ])
    assert.equal(ordinaryProjectWrite({ path: file }), false, file);
  assert.equal(
    ordinaryProjectWrite({
      path: "main.py",
      content: "#!/usr/bin/python3\nprint(1)",
    }),
    false,
  );
  assert.equal(
    ordinaryProjectWrite({
      path: "main.go",
      before: "existing code",
      content: "",
    }),
    false,
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-policy-files-"));
  try {
    await fs.writeFile(path.join(dir, "main.go"), "old");
    let change = await inspectWrite(dir, path.join(dir, "main.go"), "new");
    assert.equal(change.path, "main.go");
    assert.equal(ordinaryProjectWrite(change), true);
    await fs.chmod(path.join(dir, "main.go"), 0o755);
    change = await inspectWrite(dir, "main.go", "new");
    assert.equal(ordinaryProjectWrite(change), false);
    await fs.symlink("main.go", path.join(dir, "alias.go"));
    assert.equal(
      ordinaryProjectWrite(await inspectWrite(dir, "alias.go", "new")),
      false,
    );
    await fs.writeFile(path.join(dir, "main.go"), "external edit");
    await assert.rejects(applyWrite(dir, change), /changed since/);
    await assert.rejects(inspectWrite(dir, "../escape.go", "bad"), /outside/);
    await assert.rejects(inspectWrite(dir, ".env", "bad"), /outside/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("project defaults and task overrides persist across SQLite restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-policy-store-"));
  let store;
  try {
    store = new Store(dir);
    store.data.projects.push({
      id: "p",
      name: "Project",
      path: dir,
      approvalPolicy: { mode: "risky", trustedCommands: ["go test ./..."] },
    });
    const inherited = store.addTask({ projectId: "p", mode: "agent" });
    const override = store.addTask({
      projectId: "p",
      mode: "agent",
      approvalPolicy: { mode: "always" },
    });
    const ids = [inherited.id, override.id];
    store.close();
    store = new Store(dir);
    assert.equal(
      effectiveApprovalPolicy(store.task(ids[0]), store.project("p")).mode,
      "risky",
    );
    assert.deepEqual(
      effectiveApprovalPolicy(store.task(ids[0]), store.project("p"))
        .trustedCommands,
      ["go test ./..."],
    );
    assert.equal(
      effectiveApprovalPolicy(store.task(ids[1]), store.project("p")).mode,
      "always",
    );
  } finally {
    store?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
