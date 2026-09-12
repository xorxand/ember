import { id, activeStatuses } from "./store.mjs";
import { modelName, ndjson, isCloud } from "./ollama.mjs";
export class Downloads {
  constructor(store, ollama) {
    this.store = store;
    this.ollama = ollama;
    this.active = null;
    this.closing = false;
  }
  inUse(name) {
    return this.store.data.tasks.some(
      (t) => activeStatuses.includes(t.status) && modelName(t.model) === name,
    );
  }
  add(value) {
    const name = modelName(value);
    if (isCloud({ name }))
      throw new Error(
        "Choose a downloadable local variant. Cloud models are excluded from this workspace.",
      );
    if (this.inUse(name))
      throw new Error(
        "This model is in use by a task. Wait for the task to finish before updating it.",
      );
    const existing = this.store.data.downloads.find(
      (d) => d.name === name && ["queued", "downloading"].includes(d.status),
    );
    if (existing) return existing;
    const job = {
      id: id(),
      name,
      status: "queued",
      detail: "Waiting to download",
      completed: 0,
      total: 0,
      createdAt: new Date().toISOString(),
      layers: {},
    };
    this.store.data.downloads.unshift(job);
    this.store.touch();
    this.pump();
    return job;
  }
  cancel(jobId) {
    const d = this.store.data.downloads.find((d) => d.id === jobId);
    if (!d) throw new Error("Download not found");
    if (!["queued", "downloading"].includes(d.status))
      throw new Error("This download is no longer active.");
    d.status = "paused";
    d.detail = "Paused. Resume to reuse downloaded layers.";
    if (this.active?.id === jobId) this.active.controller.abort();
    this.store.touch();
  }
  resume(jobId) {
    const d = this.store.data.downloads.find((d) => d.id === jobId);
    if (!d) throw new Error("Download not found");
    if (!["paused", "failed"].includes(d.status))
      throw new Error("This download cannot be resumed.");
    if (this.inUse(d.name))
      throw new Error("Wait for tasks using this model to finish.");
    d.status = "queued";
    d.error = null;
    this.store.touch();
    this.pump();
  }
  async pump() {
    if (this.active || this.closing) return;
    const job = this.store.data.downloads.find((d) => d.status === "queued");
    if (!job) return;
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    job.status = "downloading";
    this.store.touch();
    let lastPersist = 0;
    try {
      if (this.inUse(job.name))
        throw new Error(
          "Model is now in use. Resume this download when the task finishes.",
        );
      const res = await this.ollama.request("/api/pull", {
        method: "POST",
        body: { model: job.name, stream: true },
        signal: controller.signal,
        timeout: 24 * 60 * 60 * 1000,
      });
      let success = false;
      for await (const chunk of ndjson(res.body)) {
        if (chunk.error) throw new Error(chunk.error);
        job.detail = chunk.status || "Downloading";
        if (chunk.digest && chunk.total) {
          const prev = job.layers[chunk.digest] || {};
          job.layers[chunk.digest] = {
            total: chunk.total,
            completed: chunk.completed ?? prev.completed ?? 0,
          };
        }
        job.total = Object.values(job.layers).reduce((s, l) => s + l.total, 0);
        job.completed = Object.values(job.layers).reduce(
          (s, l) => s + l.completed,
          0,
        );
        success ||= chunk.status === "success";
        const persist = Date.now() - lastPersist > 1500;
        if (persist) lastPersist = Date.now();
        this.store.touch({ persist });
      }
      if (!success)
        throw new Error(
          "The download stream ended before Ollama confirmed success. Resume to retry.",
        );
      delete this.store.data.updateChecks[job.name];
      await this.ollama.refresh();
      job.status = "complete";
      job.completed = job.total;
      job.detail = "Ready to use";
      job.finishedAt = new Date().toISOString();
    } catch (e) {
      if (controller.signal.aborted) {
        job.status = "paused";
        job.detail = "Paused. Resume to continue.";
      } else {
        job.status = "failed";
        job.error = e.message;
        job.detail = "Download failed";
      }
    } finally {
      this.active = null;
      this.store.touch();
      this.pump();
    }
  }
  close() {
    this.closing = true;
    this.active?.controller.abort();
  }
}
