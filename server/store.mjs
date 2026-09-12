import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
export const id = () => randomUUID();
export const activeStatuses = ["queued", "running", "approval"];
export class Store extends EventEmitter {
  constructor(directory) {
    super();
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "workspace.json");
    const defaults = {
      version: 1,
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
    };
    // Never replace unreadable/corrupt user data with an empty workspace.
    this.data = fs.existsSync(this.file)
      ? { ...defaults, ...JSON.parse(fs.readFileSync(this.file, "utf8")) }
      : defaults;
    for (const task of this.data.tasks)
      if (activeStatuses.includes(task.status)) {
        task.status = "interrupted";
        task.error =
          "The app closed during this turn. Send a message to continue.";
        for (const approval of task.approvals || [])
          if (approval.status === "pending") approval.status = "interrupted";
      }
    for (const d of this.data.downloads)
      if (["queued", "downloading"].includes(d.status)) {
        d.status = "paused";
        d.detail = "Paused when the app closed. Resume to continue.";
      }
    this.save();
  }
  save() {
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  touch({ persist = true } = {}) {
    if (persist) this.save();
    this.emit("change");
  }
  task(taskId) {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");
    return task;
  }
  project(projectId) {
    const p = this.data.projects.find((p) => p.id === projectId);
    if (!p) throw new Error("Project not found");
    return p;
  }
  addTask({ projectId = null, title = "New task", model, mode = "chat" } = {}) {
    const project = projectId ? this.project(projectId) : null;
    const t = {
      id: id(),
      projectId,
      title: String(title).slice(0, 120),
      model: model || project?.model || this.data.settings.defaultModel,
      mode: mode === "agent" && project ? "agent" : "chat",
      messages: [],
      approvals: [],
      status: "idle",
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.tasks.unshift(t);
    this.touch();
    return t;
  }
}
