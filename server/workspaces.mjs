import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
const exec = promisify(execFile);
export async function git(root, args, env = {}) {
  try {
    return (
      await exec(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          "-C",
          root,
          ...args,
        ],
        {
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
        },
      )
    ).stdout;
  } catch (e) {
    throw new Error((e.stderr || e.message).trim());
  }
}
export class Workspaces {
  constructor(store) {
    this.store = store;
    this.locks = new Map();
    this.applying = new Set();
  }
  async ensure(task, project) {
    if (!project) return null;
    if (task.workspace) {
      await fs.access(task.workspace.path);
      return { ...project, path: task.workspace.path };
    }
    if (task.mode !== "agent") return project;
    if (this.locks.has(task.id)) return this.locks.get(task.id);
    const job = this.create(task, project);
    this.locks.set(task.id, job);
    try {
      return await job;
    } finally {
      this.locks.delete(task.id);
    }
  }
  async create(task, project) {
    let repository;
    try {
      repository = (
        await git(project.path, ["rev-parse", "--show-toplevel"])
      ).trim();
    } catch (e) {
      // Never silently downgrade a Git failure into shared writes.
      if (!/not a git repository/.test(e.message)) throw e;
      let current = project.path;
      while (true) {
        let marker = false;
        try {
          const info = await fs.stat(path.join(current, ".git"));
          if (info.isFile()) marker = true;
          else {
            await fs.access(path.join(current, ".git", "HEAD"));
            marker = true;
          }
        } catch (check) {
          if (check.code !== "ENOENT") throw check;
        }
        if (marker)
          throw new Error("Git isolation could not be prepared: " + e.message);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      task.workspace = {
        mode: "shared",
        path: project.path,
        reason:
          "This folder is not a Git repository. Agent tasks here run one at a time.",
      };
      this.store.touch({ taskId: task.id });
      return project;
    }
    let baseCommit = (
      await git(repository, ["rev-parse", "--verify", "HEAD"])
    ).trim();
    const root = path.join(this.store.directory, "worktrees", task.id);
    const branch = "ember/task-" + task.id;
    await fs.mkdir(path.dirname(root), { recursive: true });
    // Repair the narrow crash window after git creates a worktree but before metadata is saved.
    let exists = false;
    try {
      exists =
        (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() ===
        branch;
    } catch {}
    if (exists) baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    if (!exists)
      await git(repository, [
        "worktree",
        "add",
        "-b",
        branch,
        root,
        baseCommit,
      ]);
    const relative = path.relative(repository, project.path);
    const taskPath = path.join(root, relative);
    await fs.access(taskPath);
    task.workspace = {
      mode: "worktree",
      path: taskPath,
      root,
      repository,
      branch,
      baseCommit,
      createdAt: new Date().toISOString(),
    };
    this.store.touch({ taskId: task.id });
    return { ...project, path: taskPath };
  }
  path(task, project) {
    return task?.workspace?.path || project.path;
  }
  async review(task) {
    const w = task.workspace;
    if (w?.mode !== "worktree")
      throw new Error("This task does not have an isolated worktree.");
    const index = path.join(
      this.store.directory,
      "review-index-" + randomUUID(),
    );
    const env = { GIT_INDEX_FILE: index };
    try {
      await git(w.root, ["read-tree", "HEAD"], env);
      await git(w.root, ["add", "-A", "--", "."], env);
      // Compare against the original base, including commits the task may have made.
      const patch = await git(
        w.root,
        ["diff", "--cached", "--binary", w.baseCommit],
        env,
      );
      const stat = await git(
        w.root,
        ["diff", "--cached", "--stat", w.baseCommit],
        env,
      );
      return {
        patch,
        stat,
        digest: createHash("sha256").update(patch).digest("hex"),
        branch: w.branch,
        baseCommit: w.baseCommit,
        projectPath: w.repository,
      };
    } finally {
      await fs.rm(index, { force: true });
      await fs.rm(index + ".lock", { force: true });
    }
  }
  async apply(task, digest) {
    const w = task.workspace;
    if (w?.mode !== "worktree") throw new Error("No isolated worktree.");
    if (this.applying.has(w.repository))
      throw new Error("Another task is applying changes to this project.");
    this.applying.add(w.repository);
    try {
      const review = await this.review(task);
      if (!review.patch) throw new Error("There are no changes to apply.");
      if (digest !== review.digest)
        throw new Error(
          "The worktree changed since review. Review it again before applying.",
        );
      if (
        (await git(w.repository, ["rev-parse", "HEAD"])).trim() !== w.baseCommit
      )
        throw new Error(
          "The original project has new commits. Integrate this branch manually or start a new task from the current HEAD.",
        );
      if ((await git(w.repository, ["status", "--porcelain"])).trim())
        throw new Error(
          "The original project has uncommitted changes. Commit or move them before applying this task.",
        );
      const patchFile = path.join(
        this.store.directory,
        "apply-" + randomUUID() + ".patch",
      );
      try {
        await fs.writeFile(patchFile, review.patch, { mode: 0o600 });
        await git(w.repository, ["apply", "--check", patchFile]);
        await git(w.repository, ["apply", patchFile]);
      } finally {
        await fs.rm(patchFile, { force: true });
      }
      task.workspace = { ...w, appliedAt: new Date().toISOString() };
      this.store.touch({ taskId: task.id });
      return {
        ok: true,
        message:
          "Applied to the original project as uncommitted changes. The task branch is retained.",
      };
    } finally {
      this.applying.delete(w.repository);
    }
  }
}
