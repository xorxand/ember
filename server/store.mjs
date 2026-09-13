import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export const id = () => randomUUID();
export const activeStatuses = ["queued", "running", "approval"];
const defaults = () => ({
  version: 2,
  settings: {
    endpoint: "http://127.0.0.1:11434",
    defaultModel: "",
    contextLength: 8192,
    temperature: 0.6,
    concurrency: 1,
    theme: "dark",
    onboarded: false,
  },
  projects: [],
  tasks: [],
  downloads: [],
  catalog: { models: [], fetchedAt: null },
  updateChecks: {},
});
export class Store extends EventEmitter {
  constructor(directory) {
    super();
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "workspace.sqlite");
    this.legacyFile = path.join(directory, "workspace.json");
    // Parse before touching the database, so a corrupt legacy file is never replaced.
    const legacy =
      !fs.existsSync(this.file) && fs.existsSync(this.legacyFile)
        ? JSON.parse(fs.readFileSync(this.legacyFile, "utf8"))
        : null;
    this.db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(updated DESC,id);
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),role TEXT,content TEXT,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_task ON messages(task_id,seq DESC);
      CREATE TABLE IF NOT EXISTS approvals(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS approvals_task ON approvals(task_id,seq DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(content,content='messages',content_rowid='seq');
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO message_search(rowid,content) VALUES(new.seq,new.content); END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO message_search(message_search,rowid,content) VALUES('delete',old.seq,old.content); END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN INSERT INTO message_search(message_search,rowid,content) VALUES('delete',old.seq,old.content); INSERT INTO message_search(rowid,content) VALUES(new.seq,new.content); END;`);
    this.dirty = new Set();
    this.details = new Map();
    this.byId = new Map();
    this.savedMeta = new Map();
    this.closed = false;
    const seeded = this.db
      .prepare("SELECT data FROM meta WHERE key='version'")
      .get();
    if (!seeded) {
      const source =
        legacy ||
        (fs.existsSync(this.legacyFile)
          ? JSON.parse(fs.readFileSync(this.legacyFile, "utf8"))
          : defaults());
      if (source.version && source.version !== 1 && source.version !== 2)
        throw new Error("Unsupported workspace version.");
      if (
        fs.existsSync(this.legacyFile) &&
        !fs.existsSync(this.legacyFile + ".pre-sqlite")
      )
        fs.copyFileSync(
          this.legacyFile,
          this.legacyFile + ".pre-sqlite",
          fs.constants.COPYFILE_EXCL,
        );
      this.data = {
        ...defaults(),
        ...source,
        settings: { ...defaults().settings, ...source.settings },
        version: 2,
        tasks: [],
      };
      for (const raw of source.tasks || []) {
        const { messages = [], approvals = [], ...meta } = raw;
        const t = this.wrapTask(meta);
        this.data.tasks.push(t);
        this.details.set(t.id, { messages, approvals });
        this.dirty.add(t.id);
      }
      this.save();
      this.details.clear();
    } else {
      if (JSON.parse(seeded.data) !== 2)
        throw new Error("This workspace needs a newer Ember version.");
      this.data = defaults();
      for (const row of this.db.prepare("SELECT key,data FROM meta").all()) {
        this.data[row.key] = JSON.parse(row.data);
        this.savedMeta.set(row.key, row.data);
      }
      this.data.tasks = this.db
        .prepare("SELECT data FROM tasks ORDER BY updated DESC,id")
        .all()
        .map((r) => this.wrapTask(JSON.parse(r.data)));
    }
    for (const t of this.data.tasks)
      if (activeStatuses.includes(t.status)) {
        t.status = "interrupted";
        t.error =
          "The app closed during this turn. Send a message to continue.";
        for (const a of t.approvals)
          if (["pending", "executing", "approved"].includes(a.status))
            a.status = "interrupted";
      }
    for (const d of this.data.downloads)
      if (["queued", "downloading"].includes(d.status)) {
        d.status = "paused";
        d.detail = "Paused when the app closed. Resume to continue.";
      }
    this.save();
    this.prune();
  }
  wrapTask(meta) {
    const store = this;
    const raw = { messageCount: 0, ...meta };
    Object.defineProperties(raw, {
      messages: {
        enumerable: false,
        get() {
          return store.loadDetails(raw.id).messages;
        },
      },
      approvals: {
        enumerable: false,
        get() {
          return store.loadDetails(raw.id).approvals;
        },
      },
    });
    const proxy = new Proxy(raw, {
      set(target, key, value) {
        if (target[key] !== value) store.dirty.add(target.id);
        target[key] = value;
        return true;
      },
    });
    this.byId.set(raw.id, proxy);
    return proxy;
  }
  loadDetails(taskId) {
    let detail = this.details.get(taskId);
    if (!detail) {
      let rows = this.db
        .prepare(
          "SELECT data FROM messages WHERE task_id=? ORDER BY seq DESC LIMIT 200",
        )
        .all(taskId)
        .reverse()
        .map((r) => JSON.parse(r.data));
      // A bounded prompt window starts with a complete user turn.
      const firstUser = rows.findIndex((m) => m.role === "user");
      if (firstUser > 0) rows = rows.slice(firstUser);
      detail = {
        messages: rows,
        approvals: this.db
          .prepare(
            "SELECT data FROM approvals WHERE task_id=? ORDER BY seq DESC LIMIT 100",
          )
          .all(taskId)
          .reverse()
          .map((r) => JSON.parse(r.data)),
      };
      this.details.set(taskId, detail);
    } else {
      this.details.delete(taskId);
      this.details.set(taskId, detail);
    }
    this.dirty.add(taskId); // Mutable arrays are flushed row-by-row, never as a history blob.
    return detail;
  }
  prune() {
    for (const [taskId, detail] of this.details)
      if (
        detail.messages.length > 200 &&
        !activeStatuses.includes(this.byId.get(taskId)?.status) &&
        !this.dirty.has(taskId)
      )
        this.details.delete(taskId);
    for (const [taskId] of this.details) {
      if (this.details.size <= 12) break;
      if (
        !activeStatuses.includes(this.byId.get(taskId)?.status) &&
        !this.dirty.has(taskId)
      )
        this.details.delete(taskId);
    }
  }
  save() {
    if (this.closed) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const upTask = this.db.prepare(
        "INSERT INTO tasks(id,updated,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data",
      );
      for (const taskId of this.dirty) {
        const t = this.byId.get(taskId);
        if (!t) continue;
        const meta = { ...t };
        upTask.run(t.id, t.updatedAt, JSON.stringify(meta));
        const detail = this.details.get(taskId);
        if (detail)
          for (const table of ["messages", "approvals"]) {
            const lookup = this.db.prepare(
              `SELECT data FROM ${table} WHERE id=?`,
            );
            const insert =
              table === "messages"
                ? this.db.prepare(
                    "INSERT INTO messages(id,task_id,role,content,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,content=excluded.content,data=excluded.data",
                  )
                : this.db.prepare(
                    "INSERT INTO approvals(id,task_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                  );
            for (const row of detail[table]) {
              row.id ||= id();
              const raw = JSON.stringify(row);
              if (lookup.get(row.id)?.data === raw) continue;
              if (table === "messages")
                insert.run(
                  row.id,
                  taskId,
                  row.role || "",
                  (row.content || "") +
                    (row.attachments || [])
                      .map((a) => "\n" + a.content)
                      .join(""),
                  raw,
                );
              else insert.run(row.id, taskId, raw);
            }
          }
        meta.messageCount = Number(
          this.db
            .prepare("SELECT count(*) AS n FROM messages WHERE task_id=?")
            .get(taskId).n,
        );
        t.messageCount = meta.messageCount;
        upTask.run(t.id, t.updatedAt, JSON.stringify(meta));
      }
      for (const [key, value] of Object.entries(this.data))
        if (key !== "tasks") {
          const raw = JSON.stringify(value);
          if (this.savedMeta.get(key) !== raw)
            this.db
              .prepare(
                "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
              )
              .run(key, raw);
        }
      this.db.exec("COMMIT");
      this.dirty.clear();
      for (const [key, value] of Object.entries(this.data))
        if (key !== "tasks") this.savedMeta.set(key, JSON.stringify(value));
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.prune();
  }
  touch({ persist = true, taskId } = {}) {
    if (taskId) this.dirty.add(taskId);
    if (persist) this.save();
    this.emit("change");
  }
  task(taskId) {
    const t = this.byId.get(taskId);
    if (!t) throw new Error("Task not found");
    return t;
  }
  project(projectId) {
    const p = this.data.projects.find((p) => p.id === projectId);
    if (!p) throw new Error("Project not found");
    return p;
  }
  addTask({ projectId = null, title = "New task", model, mode = "chat" } = {}) {
    const project = projectId ? this.project(projectId) : null;
    const t = this.wrapTask({
      id: id(),
      projectId,
      title: String(title).slice(0, 120),
      model: model || project?.model || this.data.settings.defaultModel,
      mode: mode === "agent" && project ? "agent" : "chat",
      status: "idle",
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.data.tasks.unshift(t);
    this.dirty.add(t.id);
    this.touch();
    return t;
  }
  summaries({ offset = 0, limit = 100, query = "", projectId } = {}) {
    const size = Math.min(100, Math.max(1, Number(limit) || 100));
    const start = Math.max(0, Number(offset) || 0);
    let list = this.data.tasks;
    if (projectId) list = list.filter((t) => t.projectId === projectId);
    if (query.trim()) {
      const terms =
        query
          .trim()
          .match(/[\p{L}\p{N}_]+/gu)
          ?.slice(0, 12) || [];
      const found = terms.length
        ? new Set(
            this.db
              .prepare(
                "SELECT DISTINCT m.task_id FROM message_search s JOIN messages m ON m.seq=s.rowid WHERE message_search MATCH ? LIMIT 5000",
              )
              .all(terms.map((s) => '"' + s + '"*').join(" AND "))
              .map((r) => r.task_id),
          )
        : new Set();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(query.toLowerCase()) ||
          found.has(t.id),
      );
    }
    const items = list
      .slice(start, start + size)
      .map((t) => ({ ...t, messages: [], approvals: [], detailLoaded: false }));
    return {
      items,
      total: list.length,
      nextOffset: start + size < list.length ? start + size : null,
    };
  }
  detail(taskId) {
    const t = this.task(taskId);
    const d = this.loadDetails(taskId);
    return {
      ...t,
      messages: d.messages.slice(-60),
      approvals: d.approvals,
      detailLoaded: true,
      hasOlderMessages: t.messageCount > Math.min(60, d.messages.length),
    };
  }
  messagePage(taskId, beforeId, limit = 60) {
    this.task(taskId);
    const before = beforeId
      ? this.db
          .prepare("SELECT seq FROM messages WHERE id=? AND task_id=?")
          .get(beforeId, taskId)?.seq
      : Number.MAX_SAFE_INTEGER;
    if (!before) throw new Error("Message cursor not found.");
    const rows = this.db
      .prepare(
        "SELECT seq,data FROM messages WHERE task_id=? AND seq<? ORDER BY seq DESC LIMIT ?",
      )
      .all(taskId, before, Math.min(100, Math.max(1, Number(limit) || 60)))
      .reverse();
    return {
      messages: rows.map((r) => JSON.parse(r.data)),
      hasMore: Boolean(
        rows.length &&
        this.db
          .prepare("SELECT 1 FROM messages WHERE task_id=? AND seq<? LIMIT 1")
          .get(taskId, rows[0].seq),
      ),
    };
  }
  close() {
    if (this.closed) return;
    this.save();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.close();
    this.closed = true;
  }
}
