import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
const exec = promisify(execFile);
export function validateEndpoint(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "Use an HTTP(S) server address without credentials or a path.",
    );
  return url.origin;
}
export function modelName(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(value) ||
    value.includes("..") ||
    value.length > 200
  )
    throw new Error("Enter a valid Ollama model name, such as qwen3.5:4b.");
  return value.includes(":") ? value : `${value}:latest`;
}
export function isCloud(model) {
  return Boolean(
    model.remote_host ||
    /(?:^|[-:])cloud(?:$|-)/i.test(model.name || model.model || ""),
  );
}
export async function* ndjson(body) {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
    if (pending.length > 10_000_000)
      throw new Error("Ollama returned an oversized response.");
  }
  pending += decoder.decode();
  if (pending.trim()) yield JSON.parse(pending);
}
export class Ollama {
  constructor(store) {
    this.store = store;
    this.status = { connected: false, models: [], running: [], checking: true };
    this.child = null;
  }
  async request(route, { method = "GET", body, signal, timeout = 15000 } = {}) {
    const signals = [AbortSignal.timeout(timeout)];
    if (signal) signals.push(signal);
    const res = await fetch(this.store.data.settings.endpoint + route, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any(signals),
    });
    if (!res.ok) {
      const text = await res.text();
      let error = text;
      try {
        error = JSON.parse(text).error || text;
      } catch {}
      throw new Error(error || `Ollama returned ${res.status}`);
    }
    return res;
  }
  async json(route, options) {
    const res = await this.request(route, options);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
  async refresh() {
    try {
      const [tags, version, ps] = await Promise.all([
        this.json("/api/tags", { timeout: 4000 }),
        this.json("/api/version", { timeout: 4000 }),
        this.json("/api/ps", { timeout: 4000 }).catch(() => ({ models: [] })),
      ]);
      this.status = {
        connected: true,
        checking: false,
        models: tags.models || [],
        running: ps.models || [],
        version: version.version,
        error: null,
      };
      if (!this.store.data.settings.defaultModel) {
        const local = this.status.models
          .filter(
            (m) => !isCloud(m) && !(m.capabilities || []).includes("embedding"),
          )
          .sort((a, b) => a.size - b.size);
        if (local[0]) {
          this.store.data.settings.defaultModel = local[0].name;
          this.store.touch();
        }
      }
    } catch (e) {
      this.status = {
        ...this.status,
        connected: false,
        checking: false,
        error: `Cannot connect to Ollama at ${this.store.data.settings.endpoint}. ${e.message}`,
      };
    }
    this.store.emit("change");
    return this.status;
  }
  async detect() {
    let version = null;
    try {
      const r = await exec(
        process.env.OLLAMA_BINARY || "ollama",
        ["--version"],
        { timeout: 6000 },
      );
      version = (r.stdout + r.stderr).trim();
    } catch {}
    return {
      installed: Boolean(version),
      version,
      platform: process.platform,
      arch: process.arch,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      endpoint: this.store.data.settings.endpoint,
    };
  }
  async start() {
    const endpoint = new URL(this.store.data.settings.endpoint);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
      throw new Error("Start is only available for a local Ollama server.");
    if ((await this.refresh()).connected) return this.status;
    if (this.child && this.child.exitCode === null)
      throw new Error("Ollama is still starting. Try reconnecting shortly.");
    this.child = spawn(process.env.OLLAMA_BINARY || "ollama", ["serve"], {
      env: { ...process.env, OLLAMA_HOST: endpoint.host },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let logs = "";
    this.child.stderr.on("data", (data) => {
      logs = (logs + data).slice(-4000);
    });
    this.child.on("error", (e) => {
      logs = e.message;
    });
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if ((await this.refresh()).connected) return this.status;
      if (this.child.exitCode !== null) break;
    }
    throw new Error(
      logs || "Ollama could not start. Install it first, then retry.",
    );
  }
  stopOwned() {
    this.child?.kill();
  }
}
