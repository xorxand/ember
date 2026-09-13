import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { safePath, ignored, sensitive } from "./projects.mjs";
const blocked = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.data/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/auth.json",
  "**/credentials",
  "**/id_rsa",
  "**/id_ed25519",
];
const symbolPattern =
  /^\s*(?:export\s+(?:default\s+)?)?(?:(?:async|public|private|protected|static|abstract)\s+)*(?:(?:function|class|interface|type|enum|def|struct|trait|fn)\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|func\s+(?:\([^)]*\)\s*)?([\w$]+))/;
export class Search {
  constructor() {
    this.indexes = new Map();
    this.pending = new Map();
  }
  async files(root, signal) {
    const now = Date.now();
    const prior = this.indexes.get(root);
    if (prior && now - prior.at < 10000) return prior;
    if (this.pending.has(root)) return this.pending.get(root);
    const job = this.build(root, signal);
    this.pending.set(root, job);
    try {
      const index = await job;
      this.indexes.set(root, index);
      while (this.indexes.size > 8)
        this.indexes.delete(this.indexes.keys().next().value);
      return index;
    } finally {
      this.pending.delete(root);
    }
  }
  async build(root, signal) {
    const args = [
      "--files",
      "--hidden",
      "-0",
      "--no-messages",
      ...blocked.flatMap((g) => ["--glob", "!" + g]),
      ".",
    ];
    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.env.EMBER_RG || "rg", args, {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let text = "",
          error = "",
          truncated = false;
        const kill = () => child.kill();
        signal?.addEventListener("abort", kill, { once: true });
        const timer = setTimeout(kill, 12000);
        child.stdout.on("data", (b) => {
          text += b.toString();
          if (text.length > 4_000_000) {
            truncated = true;
            kill();
          }
        });
        child.stderr.on("data", (b) => {
          error += b;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", kill);
          if (signal?.aborted) return reject(new Error("Search cancelled"));
          if (code !== 0 && code !== 1 && !truncated)
            return reject(new Error(error || "File scan timed out"));
          resolve({
            paths: text
              .split("\0")
              .filter(Boolean)
              .map((p) => p.replace(/^\.\//, "")),
            truncated,
            engine: "ripgrep",
          });
        });
      });
      // rg obeys ignore files and does not follow symlinks. Verify roots again when reading.
      return { ...result, at: Date.now() };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const paths = [];
    let visited = 0,
      truncated = false;
    const deadline = Date.now() + 12000;
    const walk = async (relative) => {
      for (const entry of await fs.readdir(path.join(root, relative), {
        withFileTypes: true,
      })) {
        if (signal?.aborted) throw new Error("Search cancelled");
        if (++visited > 30000 || Date.now() > deadline) {
          truncated = true;
          return;
        }
        if (
          entry.isSymbolicLink() ||
          ignored.has(entry.name) ||
          sensitive(entry.name)
        )
          continue;
        const next = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(next);
        else if (entry.isFile()) paths.push(next);
        if (truncated) return;
      }
    };
    await walk("");
    return {
      paths,
      at: Date.now(),
      truncated,
      engine: "bounded fallback (install ripgrep to respect Git ignore rules)",
    };
  }
  async textSearch(root, query, limit, signal) {
    if (!query)
      return { matches: [], truncated: false, engine: "ripgrep", scanned: 0 };
    const args = [
      "--json",
      "--fixed-strings",
      "--ignore-case",
      "--hidden",
      "--max-filesize",
      "250K",
      "--no-messages",
      ...blocked.flatMap((g) => ["--glob", "!" + g]),
      "--",
      query,
      ".",
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.env.EMBER_RG || "rg", args, {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "",
        error = "",
        truncated = false,
        scanned = 0;
      const matches = [];
      const stop = () => child.kill();
      const timer = setTimeout(() => {
        truncated = true;
        stop();
      }, 5000);
      signal?.addEventListener("abort", stop, { once: true });
      child.on("error", (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        reject(e);
      });
      child.stderr.on("data", (b) => {
        error = (error + b).slice(-2000);
      });
      child.stdout.on("data", (b) => {
        buffer += b.toString();
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let item;
          try {
            item = JSON.parse(line);
          } catch {
            continue;
          }
          if (item.type === "begin") scanned++;
          if (item.type === "match" && matches.length < limit) {
            const d = item.data;
            if (d.path.text)
              matches.push({
                path: d.path.text.replace(/^\.\//, ""),
                line: d.line_number,
                text: (d.lines.text || "").trimEnd().slice(0, 600),
              });
            if (matches.length >= limit) {
              truncated = true;
              stop();
            }
          }
        }
        if (buffer.length > 1000000) {
          truncated = true;
          stop();
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (signal?.aborted) return reject(new Error("Search cancelled"));
        if (code !== 0 && code !== 1 && !truncated)
          return reject(new Error(error || "Repository search failed"));
        resolve({ matches, truncated, scanned, engine: "ripgrep" });
      });
    });
    const safe = [];
    for (const m of result.matches) {
      try {
        await safePath(root, m.path);
        safe.push(m);
      } catch {}
    }
    return { ...result, matches: safe };
  }
  async search(root, { query = "", kind = "text", limit = 50, signal } = {}) {
    if (typeof query !== "string" || query.length > 500)
      throw new Error("Search text must be at most 500 characters.");
    if (!["text", "files", "symbols"].includes(kind))
      throw new Error("Unknown search mode");
    const maxNative = Math.min(100, Math.max(1, Number(limit) || 50));
    if (kind === "text") {
      try {
        return await this.textSearch(root, query, maxNative, signal);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const index = await this.files(root, signal);
    const q = query.toLowerCase();
    const max = Math.min(100, Math.max(1, Number(limit) || 50));
    const matches = [];
    let scanned = 0,
      bytes = 0,
      truncated = index.truncated;
    const deadline = Date.now() + 5000;
    if (kind === "files") {
      const all = index.paths.filter((p) => p.toLowerCase().includes(q));
      return {
        matches: all.slice(0, max).map((p) => ({ path: p })),
        truncated: truncated || all.length > max,
        engine: index.engine,
        scanned: index.paths.length,
      };
    }
    // Rank likely paths first. Content is read only for the search, not retained as a repository-sized prompt.
    const paths = [...index.paths].sort(
      (a, b) =>
        Number(b.toLowerCase().includes(q)) -
        Number(a.toLowerCase().includes(q)),
    );
    for (const relative of paths) {
      if (signal?.aborted) throw new Error("Search cancelled");
      if (scanned >= 6000 || bytes > 32_000_000 || Date.now() > deadline) {
        truncated = true;
        break;
      }
      try {
        const target = await safePath(root, relative);
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > 250000) continue;
        const text = await fs.readFile(target, "utf8");
        scanned++;
        bytes += stat.size;
        if (text.includes("\0")) continue;
        for (const [i, line] of text.split("\n").entries()) {
          const symbol = kind === "symbols" ? symbolPattern.exec(line) : null;
          if (
            kind === "symbols"
              ? symbol &&
                (symbol[1] || symbol[2] || symbol[3]).toLowerCase().includes(q)
              : q && line.toLowerCase().includes(q)
          )
            matches.push({
              path: relative,
              line: i + 1,
              text: line.slice(0, 600),
              ...(symbol
                ? { symbol: symbol[1] || symbol[2] || symbol[3] }
                : {}),
            });
          if (matches.length >= max) {
            truncated = true;
            break;
          }
        }
      } catch (e) {
        if (
          e.code !== "ENOENT" &&
          e.code !== "EACCES" &&
          !/allowed|escape/.test(e.message)
        )
          throw e;
      }
      if (matches.length >= max) break;
    }
    return { matches, truncated, engine: index.engine, scanned };
  }
  invalidate(root) {
    this.indexes.delete(root);
  }
  async excerpt(root, relative, startLine = 1, endLine = 120) {
    const target = await safePath(root, relative);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 250000)
      throw new Error("Only text files up to 250 KB are supported.");
    const text = await fs.readFile(target, "utf8");
    if (text.includes("\0")) throw new Error("Binary file");
    const lines = text.split("\n");
    const start = Math.max(1, Math.floor(Number(startLine) || 1)),
      end = Math.min(
        lines.length,
        start + 199,
        Math.floor(Number(endLine) || start + 119),
      );
    if (end < start) throw new Error("Invalid line range");
    let remaining = 12000;
    const chosen = [];
    for (let i = start - 1; i < end && remaining > 0; i++) {
      const line = `${i + 1}: ${lines[i]}`;
      chosen.push(line.slice(0, remaining));
      remaining -= line.length + 1;
    }
    return {
      path: relative,
      startLine: start,
      endLine: start + chosen.length - 1,
      totalLines: lines.length,
      content: chosen.join("\n"),
      truncated: end < lines.length || remaining <= 0,
    };
  }
}
