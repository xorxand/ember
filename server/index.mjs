import http from "node:http";
import { normalizeApprovalPolicy } from "../shared/approval-policy.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Store, id, activeStatuses } from "./store.mjs";
import { Ollama, validateEndpoint, modelName, isCloud } from "./ollama.mjs";
import { Catalog } from "./catalog.mjs";
import { Downloads } from "./downloads.mjs";
import { Agent } from "./agent.mjs";
import { Installer } from "./installer.mjs";
import { Workspaces } from "./workspaces.mjs";
import { Search } from "./search.mjs";
import { diffState } from "../shared/state-patches.js";
import { rootPath, listFiles, readFile, runCommand } from "./projects.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
export async function createApp({
  dataDir = process.env.EMBER_DATA_DIR || path.join(root, ".data"),
  port = Number(process.env.PORT || 4317),
  endpoint,
  refresh = true,
} = {}) {
  const store = new Store(dataDir);
  if (endpoint) {
    store.data.settings.endpoint = validateEndpoint(endpoint);
    store.save();
  }
  const ollama = new Ollama(store),
    catalog = new Catalog(store),
    downloads = new Downloads(store, ollama),
    workspaces = new Workspaces(store),
    search = new Search(),
    agent = new Agent(store, ollama, workspaces, search),
    installer = new Installer(store, ollama);
  const token = randomBytes(32).toString("hex");
  const clients = new Set();
  const terminals = [];
  const terminalControllers = new Map();
  let serverOrigin = "";
  let timer;
  const snapshot = (taskId = "", offset = 0, query = "", projectId = "") => {
    const page = store.summaries({ offset, query, projectId });
    const tasks = page.items;
    if (taskId && store.byId.has(taskId)) {
      const detail = store.detail(taskId);
      const index = tasks.findIndex((t) => t.id === taskId);
      if (index >= 0) tasks[index] = detail;
      else tasks.push(detail);
    }
    return {
      ...Object.fromEntries(
        Object.entries(store.data).filter(([key]) => key !== "tasks"),
      ),
      tasks,
      taskPage: { total: page.total, nextOffset: page.nextOffset, offset },
      ollama: ollama.status,
      system: {
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        platform: process.platform,
        arch: process.arch,
      },
      installer: installer.status,
      terminals,
    };
  };
  const broadcast = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      for (const client of clients) {
        if (client.res.destroyed) continue;
        if (client.res.writableLength > 2_000_000) {
          client.res.destroy();
          continue;
        }
        const next = JSON.parse(
          JSON.stringify(
            snapshot(
              client.taskId,
              client.offset,
              client.query,
              client.projectId,
            ),
          ),
        );
        const patches = diffState(client.previous, next);
        if (patches.length) {
          client.res.write(
            `data: ${JSON.stringify({ type: "patch", patches })}\n\n`,
          );
          client.previous = next;
        }
      }
    }, 90);
  };
  store.on("change", broadcast);
  const json = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const body = async (req) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
      if (Buffer.byteLength(raw) > 1_000_000)
        throw new Error("Request body exceeds 1 MB.");
    }
    return raw ? JSON.parse(raw) : {};
  };
  const validToken = (value) =>
    typeof value === "string" &&
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const projectRoot = (url) => {
    const p = store.project(url.searchParams.get("id"));
    const taskId = url.searchParams.get("task");
    const task = taskId ? store.task(taskId) : null;
    if (task && task.projectId !== p.id)
      throw new Error("Task does not belong to this project.");
    return workspaces.path(task, p);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      if (
        req.headers.host !== new URL(serverOrigin).host ||
        (req.headers.origin && req.headers.origin !== serverOrigin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return json(res, { error: "Origin not allowed" }, 403);
      const url = new URL(req.url, serverOrigin);
      const route = url.pathname;
      if (route.startsWith("/api/")) {
        if (!validToken(req.headers["x-ember-token"]))
          return json(res, { error: "Unauthorized" }, 401);
        if (req.method === "GET" && route === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const client = {
            res,
            taskId: url.searchParams.get("task") || "",
            offset: Number(url.searchParams.get("offset")) || 0,
            query: (url.searchParams.get("q") || "").slice(0, 500),
            projectId: url.searchParams.get("project") || "",
          };
          client.previous = JSON.parse(
            JSON.stringify(
              snapshot(
                client.taskId,
                client.offset,
                client.query,
                client.projectId,
              ),
            ),
          );
          res.write(
            `data: ${JSON.stringify({ type: "snapshot", state: client.previous })}\n\n`,
          );
          clients.add(client);
          const heartbeat = setInterval(
            () => res.write(": heartbeat\n\n"),
            20000,
          );
          res.on("close", () => {
            clients.delete(client);
            clearInterval(heartbeat);
          });
          return;
        }
        if (req.method === "GET" && route === "/api/state")
          return json(
            res,
            snapshot(
              url.searchParams.get("task") || "",
              Number(url.searchParams.get("offset")) || 0,
              url.searchParams.get("q") || "",
              url.searchParams.get("project") || "",
            ),
          );
        if (req.method === "GET" && route === "/api/tasks/messages")
          return json(
            res,
            store.messagePage(
              url.searchParams.get("id"),
              url.searchParams.get("before"),
              url.searchParams.get("limit"),
            ),
          );
        if (req.method === "GET" && route === "/api/tasks/worktree/review")
          return json(
            res,
            await workspaces.review(store.task(url.searchParams.get("id"))),
          );
        if (req.method === "GET" && route === "/api/projects/excerpt") {
          const line = Math.max(1, Number(url.searchParams.get("line")) || 1);
          return json(
            res,
            await search.excerpt(
              projectRoot(url),
              url.searchParams.get("path"),
              Math.max(1, line - 5),
              line + 50,
            ),
          );
        }
        if (req.method === "GET" && route === "/api/projects/search") {
          const p = store.project(url.searchParams.get("id"));
          const taskId = url.searchParams.get("task");
          const task = taskId ? store.task(taskId) : null;
          if (task && task.projectId !== p.id)
            throw new Error("Task does not belong to this project.");
          const controller = new AbortController();
          res.on("close", () => controller.abort());
          return json(
            res,
            await search.search(workspaces.path(task, p), {
              query: url.searchParams.get("q") || "",
              kind: url.searchParams.get("kind") || "text",
              signal: controller.signal,
            }),
          );
        }
        if (req.method === "GET" && route === "/api/ollama/detect")
          return json(res, await ollama.detect());
        if (req.method === "GET" && route === "/api/catalog/tags")
          return json(
            res,
            await catalog.tags(url.searchParams.get("family") || ""),
          );
        if (req.method === "GET" && route === "/api/models/info")
          return json(
            res,
            await ollama.json("/api/show", {
              method: "POST",
              body: { model: modelName(url.searchParams.get("name")) },
            }),
          );
        if (req.method === "GET" && route === "/api/projects/files")
          return json(
            res,
            await listFiles(
              projectRoot(url),
              url.searchParams.get("path") || "",
            ),
          );
        if (req.method === "GET" && route === "/api/projects/file")
          return json(res, {
            content: await readFile(
              projectRoot(url),
              url.searchParams.get("path"),
            ),
          });
        if (req.method !== "POST")
          return json(res, { error: "Not found" }, 404);
        const data = await body(req);
        if (route === "/api/settings") {
          const s = { ...store.data.settings };
          if (data.endpoint !== undefined) {
            const endpoint = validateEndpoint(data.endpoint);
            if (endpoint !== s.endpoint) {
              if (
                store.data.tasks.some((t) =>
                  activeStatuses.includes(t.status),
                ) ||
                downloads.active ||
                terminalControllers.size ||
                installer.controller
              )
                throw new Error("Finish active work before changing servers.");
              s.endpoint = endpoint;
              s.defaultModel = "";
            }
          }
          if (data.defaultModel !== undefined)
            s.defaultModel = data.defaultModel
              ? modelName(data.defaultModel)
              : "";
          if (data.contextLength !== undefined) {
            const n = Number(data.contextLength);
            if (!Number.isInteger(n) || n < 2048 || n > 131072)
              throw new Error(
                "Context length must be between 2,048 and 131,072.",
              );
            s.contextLength = n;
          }
          if (data.temperature !== undefined) {
            const n = Number(data.temperature);
            if (!Number.isFinite(n) || n < 0 || n > 2)
              throw new Error("Temperature must be between 0 and 2.");
            s.temperature = n;
          }
          if (data.concurrency !== undefined) {
            const n = Number(data.concurrency);
            if (![1, 2, 3, 4].includes(n))
              throw new Error("Concurrency must be 1–4.");
            s.concurrency = n;
          }
          if (["light", "dark"].includes(data.theme)) s.theme = data.theme;
          if (typeof data.onboarded === "boolean") s.onboarded = data.onboarded;
          if (s.endpoint !== store.data.settings.endpoint)
            ollama.status = { connected: false, models: [], running: [] };
          store.data.settings = s;
          store.touch();
          await ollama.refresh();
          agent.pump();
          return json(res, s);
        }
        if (route === "/api/ollama/reconnect")
          return json(res, await ollama.refresh());
        if (route === "/api/ollama/start")
          return json(res, await ollama.start());
        if (route === "/api/ollama/install")
          return json(res, await installer.start());
        if (route === "/api/ollama/install/cancel") {
          installer.cancel();
          return json(res, { ok: true });
        }
        if (route === "/api/catalog/refresh")
          return json(res, await catalog.refresh());
        if (route === "/api/downloads")
          return json(res, downloads.add(data.name));
        if (route === "/api/downloads/pause") {
          downloads.cancel(data.id);
          return json(res, { ok: true });
        }
        if (route === "/api/downloads/resume") {
          downloads.resume(data.id);
          return json(res, { ok: true });
        }
        if (route === "/api/models/check") {
          const targets = data.name
            ? ollama.status.models.filter((m) => m.name === data.name)
            : ollama.status.models.filter((m) => !isCloud(m));
          for (const model of targets) {
            try {
              const remote = await catalog.manifest(model.name);
              store.data.updateChecks[model.name] = {
                status:
                  remote.digest === model.digest.replace(/^sha256:/, "")
                    ? "current"
                    : "available",
                digest: remote.digest,
                size: remote.size,
                checkedAt: new Date().toISOString(),
              };
            } catch (e) {
              store.data.updateChecks[model.name] = {
                status: "unknown",
                error: e.message,
                checkedAt: new Date().toISOString(),
              };
            }
            store.touch();
          }
          return json(res, store.data.updateChecks);
        }
        if (route === "/api/models/delete" || route === "/api/models/unload") {
          const name = modelName(data.name);
          if (
            downloads.inUse(name) ||
            store.data.downloads.some(
              (d) =>
                d.name === name && ["queued", "downloading"].includes(d.status),
            )
          )
            throw new Error(
              "This model has active work. Finish or stop it first.",
            );
          if (route.endsWith("delete")) {
            await ollama.json("/api/delete", {
              method: "DELETE",
              body: { model: name },
            });
            if (store.data.settings.defaultModel === name)
              store.data.settings.defaultModel = "";
            store.touch();
          } else
            await ollama.json("/api/generate", {
              method: "POST",
              body: { model: name, keep_alive: 0 },
            });
          await ollama.refresh();
          return json(res, { ok: true });
        }
        if (route === "/api/projects") {
          const projectPath = await rootPath(data.path);
          if (store.data.projects.some((p) => p.path === projectPath))
            throw new Error("This folder is already a project.");
          const approvalPolicy = normalizeApprovalPolicy(
            data.approvalPolicy ?? { mode: "ask" },
          );
          const project = {
            id: id(),
            approvalPolicy,
            name: String(data.name || path.basename(projectPath)).slice(0, 100),
            path: projectPath,
            instructions: String(data.instructions || "").slice(0, 20000),
            model: "",
            createdAt: new Date().toISOString(),
          };
          store.data.projects.push(project);
          store.touch();
          return json(res, project);
        }
        if (route === "/api/projects/update") {
          const p = store.project(data.id);
          if (
            store.data.tasks.some(
              (t) => t.projectId === p.id && activeStatuses.includes(t.status),
            )
          )
            throw new Error(
              "Finish active project tasks before changing project settings.",
            );
          const approvalPolicy =
            data.approvalPolicy === undefined
              ? undefined
              : normalizeApprovalPolicy(data.approvalPolicy);
          const nextModel =
            data.model === undefined
              ? undefined
              : data.model
                ? modelName(data.model)
                : "";
          if (approvalPolicy !== undefined) p.approvalPolicy = approvalPolicy;
          if (data.name) p.name = String(data.name).slice(0, 100);
          if (data.instructions !== undefined)
            p.instructions = String(data.instructions).slice(0, 20000);
          if (nextModel !== undefined) p.model = nextModel;
          store.touch();
          return json(res, p);
        }
        if (route === "/api/projects/remove") {
          const p = store.project(data.id);
          if (
            store.data.tasks.some(
              (t) => t.projectId === p.id && activeStatuses.includes(t.status),
            ) ||
            terminals.some(
              (t) => t.projectId === p.id && t.status === "running",
            )
          )
            throw new Error("Stop active project work first.");
          store.data.projects = store.data.projects.filter(
            (p) => p.id !== data.id,
          );
          for (const t of store.data.tasks.filter(
            (t) => t.projectId === data.id,
          )) {
            t.projectId = null;
            t.approvalPolicy = null;
            t.mode = "chat";
          }
          store.touch();
          return json(res, { ok: true });
        }
        if (route === "/api/tasks") {
          const t = store.addTask(data);
          return json(res, store.detail(t.id));
        }
        if (route === "/api/tasks/worktree/apply") {
          const task = store.task(data.id);
          if (
            activeStatuses.includes(task.status) ||
            terminals.some(
              (t) => t.taskId === task.id && t.status === "running",
            )
          )
            throw new Error("Stop active task work before applying changes.");
          return json(res, await workspaces.apply(task, data.digest));
        }
        if (route === "/api/tasks/enable-agent") {
          const t = store.task(data.id);
          const project = store.project(data.projectId);
          await rootPath(project.path);
          // Recheck after filesystem validation, since work can start while it awaits.
          store.project(project.id);
          if (activeStatuses.includes(t.status) || t.archived)
            throw new Error("Stop or restore this task before enabling Agent.");
          if (t.projectId || t.workspace || t.approvals.length)
            throw new Error(
              "This task already has project history. Create a new project task instead.",
            );
          t.projectId = project.id;
          t.mode = "agent";
          store.touch({ taskId: t.id });
          return json(res, store.detail(t.id));
        }
        if (route === "/api/tasks/update") {
          const t = store.task(data.id);
          if (
            activeStatuses.includes(t.status) &&
            (data.model !== undefined ||
              data.mode !== undefined ||
              data.approvalPolicy !== undefined)
          )
            throw new Error(
              "Stop this task before changing its model, mode, or approvals.",
            );
          const approvalPolicy =
            data.approvalPolicy === undefined
              ? undefined
              : normalizeApprovalPolicy(data.approvalPolicy, { inherit: true });
          if (data.approvalPolicy !== undefined && t.archived)
            throw new Error("Restore this task before changing approvals.");
          const nextModel =
            data.model === undefined ? undefined : modelName(data.model);
          if (data.mode === "agent" && !t.projectId)
            throw new Error("Agent mode requires a project.");
          if (
            typeof data.archived === "boolean" &&
            activeStatuses.includes(t.status)
          )
            throw new Error("Stop the task before archiving it.");
          if (approvalPolicy !== undefined) t.approvalPolicy = approvalPolicy;
          if (data.title) t.title = String(data.title).slice(0, 120);
          if (nextModel !== undefined) t.model = nextModel;
          if (["agent", "chat"].includes(data.mode)) {
            if (data.mode === "agent" && !t.projectId)
              throw new Error("Agent mode requires a project.");
            t.mode = data.mode;
          }
          if (typeof data.archived === "boolean") {
            if (activeStatuses.includes(t.status))
              throw new Error("Stop the task before archiving it.");
            t.archived = data.archived;
          }
          store.touch();
          return json(res, store.detail(t.id));
        }
        if (route === "/api/tasks/send")
          return json(
            res,
            (agent.enqueue(data.id, data.content, data.attachments),
            store.detail(data.id)),
          );
        if (route === "/api/tasks/stop") {
          agent.cancel(data.id);
          return json(res, { ok: true });
        }
        if (route === "/api/approvals") {
          if (typeof data.approve !== "boolean")
            throw new Error("Approval must be true or false.");
          agent.resolveApproval(data.id, data.approve);
          return json(res, { ok: true });
        }
        if (route === "/api/terminal") {
          const p = store.project(data.projectId);
          if (terminalControllers.size >= 4)
            throw new Error("At most four terminal commands can run at once.");
          const task = data.taskId ? store.task(data.taskId) : null;
          if (task && task.projectId !== p.id)
            throw new Error("Task does not belong to this project.");
          if (task) await workspaces.ensure(task, p);
          const controller = new AbortController();
          const job = {
            id: id(),
            projectId: p.id,
            taskId: task?.id || null,
            command: data.command,
            output: "",
            status: "running",
            createdAt: new Date().toISOString(),
          };
          terminals.unshift(job);
          if (terminals.length > 40) {
            const old = terminals.findLastIndex((t) => t.status !== "running");
            if (old >= 0) terminals.splice(old, 1);
          }
          terminalControllers.set(job.id, controller);
          broadcast();
          runCommand(workspaces.path(task, p), data.command, {
            signal: controller.signal,
            onData: (output) => {
              job.output = output;
              broadcast();
            },
          })
            .then((r) => {
              Object.assign(job, r, {
                status: r.cancelled
                  ? "stopped"
                  : r.code === 0
                    ? "complete"
                    : "failed",
              });
            })
            .catch((e) => {
              job.output = e.message;
              job.status = "failed";
            })
            .finally(() => {
              terminalControllers.delete(job.id);
              broadcast();
            });
          return json(res, job);
        }
        if (route === "/api/terminal/stop") {
          terminalControllers.get(data.id)?.abort();
          return json(res, { ok: true });
        }
        return json(res, { error: "Not found" }, 404);
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, { error: "Method not allowed" }, 405);
      const dist = path.join(root, "dist");
      let filename =
        route === "/"
          ? path.join(dist, "index.html")
          : path.join(dist, decodeURIComponent(route));
      if (!filename.startsWith(dist + path.sep))
        return json(res, { error: "Not found" }, 404);
      if (!fs.existsSync(filename) || !(await fsp.stat(filename)).isFile()) {
        if (path.extname(route)) return json(res, { error: "Not found" }, 404);
        filename = path.join(dist, "index.html");
      }
      if (!fs.existsSync(filename))
        return json(res, { error: "Build the app first: npm run build" }, 503);
      const mime =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".json": "application/json",
        }[path.extname(filename)] || "application/octet-stream";
      let content = await fsp.readFile(filename);
      if (filename.endsWith("index.html"))
        content = Buffer.from(
          content.toString().replace("__EMBER_TOKEN__", token),
        );
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": filename.endsWith("index.html")
          ? "no-store"
          : "public, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (e) {
      if (!res.headersSent) json(res, { error: e.message }, 400);
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  serverOrigin = `http://127.0.0.1:${server.address().port}`;
  if (refresh) {
    await ollama.refresh();
    if (
      !store.data.catalog.models.length ||
      Date.now() - Date.parse(store.data.catalog.fetchedAt) > 86400000
    )
      catalog.refresh().catch(() => {});
  }
  const interval = refresh
    ? setInterval(() => ollama.refresh().catch(() => {}), 15000)
    : null;
  return {
    url: serverOrigin,
    token,
    store,
    ollama,
    catalog,
    downloads,
    agent,
    workspaces,
    search,
    server,
    snapshot,
    async close() {
      clearInterval(interval);
      clearTimeout(timer);
      store.removeListener("change", broadcast);
      agent.close();
      downloads.close();
      installer.cancel();
      for (const c of terminalControllers.values()) c.abort();
      for (const client of clients) client.res.end();
      ollama.stopOwned();
      store.save();
      await new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      });
      for (let i = 0; i < 100 && (agent.runs.size || downloads.active); i++)
        await new Promise((r) => setTimeout(r, 20));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createApp();
  console.log(`Ember is ready at ${app.url}`);
  console.log(`Workspace data: ${app.store.directory}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
