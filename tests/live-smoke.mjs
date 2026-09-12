import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { until } from "./mock-ollama.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-live-"));
const app = await createApp({
  dataDir: path.join(dir, "data"),
  port: 0,
  refresh: false,
});
try {
  await app.ollama.refresh();
  if (!app.ollama.status.connected) throw new Error("Ollama is not reachable.");
  const name = process.env.EMBER_TEST_MODEL || "qwen3.5:0.8b";
  if (!app.ollama.status.models.some((m) => m.name === name))
    throw new Error("Test model is not installed.");
  console.log("Testing live Ollama", app.ollama.status.version, name);
  const models = await app.catalog.refresh();
  console.log("Live catalog families:", models.models.length);
  const variants = await app.catalog.tags("qwen3.5");
  console.log("Local variants:", variants.filter((t) => !t.cloud).length);
  const manifest = await app.catalog.manifest(name);
  console.log(
    "Registry fingerprint matches local:",
    manifest.digest ===
      app.ollama.status.models.find((m) => m.name === name).digest,
  );
  const task = app.store.addTask({ model: name });
  app.agent.enqueue(
    task.id,
    "Reply with exactly EMBER_READY and nothing else.",
  );
  await until(
    () => !["queued", "running", "approval"].includes(task.status),
    180000,
  );
  if (task.status !== "complete") throw new Error(task.error || task.status);
  console.log("Live chat response:", task.messages.at(-1).content);
  console.log("Chat metrics:", task.messages.at(-1).metrics);
  const project = {
    id: "live-project",
    name: "Live smoke project",
    path: path.join(dir, "project"),
    instructions: "Use read_file to read README.md before answering.",
  };
  await fs.mkdir(project.path);
  await fs.writeFile(
    path.join(project.path, "README.md"),
    "The project verification word is COPPER.\n",
  );
  app.store.data.projects.push(project);
  app.store.touch();
  const agentTask = app.store.addTask({
    projectId: project.id,
    model: name,
    mode: "agent",
  });
  app.agent.enqueue(
    agentTask.id,
    "Read README.md using the read_file tool and tell me the verification word.",
  );
  await until(
    () => !["queued", "running", "approval"].includes(agentTask.status),
    180000,
  );
  if (agentTask.status !== "complete")
    throw new Error(agentTask.error || agentTask.status);
  console.log(
    "Agent tool calls:",
    agentTask.messages.filter((m) => m.role === "tool").map((m) => m.tool_name),
  );
  console.log("Agent response:", agentTask.messages.at(-1).content);
  if (
    !agentTask.messages.some(
      (m) => m.role === "tool" && m.content.includes("COPPER"),
    ) ||
    !agentTask.messages.at(-1).content.includes("COPPER")
  )
    throw new Error(
      "Live agent did not successfully retrieve and use the file contents.",
    );
  // Pull an already-current tag to exercise the real download protocol without downloading a new large model.
  const download = app.downloads.add(name);
  await until(() => ["complete", "failed"].includes(download.status), 180000);
  if (download.status !== "complete") throw new Error(download.error);
  console.log("Live pull completed:", download.name, download.detail);
} finally {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
