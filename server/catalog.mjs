import { createHash } from "node:crypto";
import { modelName } from "./ollama.mjs";
const clean = (text) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function parseCatalog(html) {
  const models = [];
  for (const match of html.matchAll(
    /<a\s+href="\/library\/([\w.-]+)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, name, block] = match;
    if (!block.includes("<h2")) continue;
    const spans = [...block.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) =>
      clean(m[1]),
    );
    const capabilities = spans.filter((s) =>
      ["tools", "vision", "thinking", "embedding", "audio", "cloud"].includes(
        s,
      ),
    );
    models.push({
      name,
      description: clean(block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || ""),
      capabilities,
      sizes: spans.filter((s) => /^\d+(?:\.\d+)?[bmt]$/.test(s)),
      pulls: spans.find((s) => /^\d+(?:\.\d+)?[MK]$/.test(s)) || "",
      updated: spans.find((s) => /ago$/.test(s)) || "",
      updatedAt:
        block.match(/title="([A-Z][a-z]{2} \d[^\"]+UTC)"/)?.[1] || null,
      url: `https://ollama.com/library/${name}`,
    });
  }
  return models;
}
export function parseTags(html, family) {
  const tags = [];
  for (const match of html.matchAll(
    /<a\s+href="\/library\/([^"\s]+:[^"\s]+)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, name, block] = match;
    if (!name.startsWith(`${family}:`) || tags.some((t) => t.name === name))
      continue;
    const text = clean(block);
    const sizeText = text.match(/(\d+(?:\.\d+)?)\s*([GMKT]B)/i);
    const size = sizeText
      ? Number(sizeText[1]) *
        ({ KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[sizeText[2].toUpperCase()] ||
          1)
      : null;
    tags.push({
      name,
      size,
      sizeLabel: sizeText?.[0] || null,
      context: text.match(/([\d.]+[KM]) context/)?.[1] || null,
      digest: text.match(/\b[a-f0-9]{12}\b/)?.[0] || null,
      cloud: /(?:^|[-:])cloud(?:$|-)/.test(name) || /cloud/i.test(text),
    });
  }
  return tags;
}
async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(18000),
    headers: { "User-Agent": "Ember/0.1 (local Ollama model manager)" },
  });
  if (!res.ok) throw new Error(`Model library returned ${res.status}.`);
  return res.text();
}
export class Catalog {
  constructor(store) {
    this.store = store;
    this.tagCache = new Map();
  }
  async refresh() {
    const html = await fetchText("https://ollama.com/library");
    const models = parseCatalog(html);
    if (!models.length)
      throw new Error(
        "The library layout changed. Use a model name to download directly; your cached catalog is still available.",
      );
    this.store.data.catalog = {
      models,
      fetchedAt: new Date().toISOString(),
      source: "https://ollama.com/library",
    };
    this.store.touch();
    return this.store.data.catalog;
  }
  async tags(family) {
    if (!/^[\w.-]+$/.test(family)) throw new Error("Invalid model family.");
    if (
      this.tagCache.has(family) &&
      Date.now() - this.tagCache.get(family).at < 300000
    )
      return this.tagCache.get(family).tags;
    const tags = parseTags(
      await fetchText(`https://ollama.com/library/${family}/tags`),
      family,
    );
    if (!tags.length)
      throw new Error(
        "No variants could be read. Enter an exact model name to pull it directly.",
      );
    this.tagCache.set(family, { tags, at: Date.now() });
    return tags;
  }
  async manifest(value) {
    const name = modelName(value);
    const [qualified, tag] = name.split(":");
    const repo = qualified.includes("/") ? qualified : `library/${qualified}`;
    const res = await fetch(
      `https://registry.ollama.ai/v2/${repo}/manifests/${tag}`,
      {
        headers: {
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok)
      throw new Error(
        `Registry returned ${res.status}; this tag may be private, custom, or unavailable.`,
      );
    const raw = await res.text();
    const manifest = JSON.parse(raw);
    return {
      digest: (
        res.headers.get("docker-content-digest") ||
        `sha256:${createHash("sha256").update(raw).digest("hex")}`
      ).replace(/^sha256:/, ""),
      size: (manifest.layers || []).reduce(
        (sum, l) => sum + (l.size || 0),
        manifest.config?.size || 0,
      ),
    };
  }
}
