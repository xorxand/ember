import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error(
    "This packaging script currently builds Linux x64 Debian packages.",
  );
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const release = path.join(root, "release");
const stage = path.join(release, "debian");
const appDir = path.join(stage, "opt", "ember");
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(appDir, { recursive: true });
await fs.cp(path.join(root, "node_modules/electron/dist"), appDir, {
  recursive: true,
});
await fs.rename(path.join(appDir, "electron"), path.join(appDir, "ember"));
await fs.rm(path.join(appDir, "resources/default_app.asar"), { force: true });
const resources = path.join(appDir, "resources/app");
await fs.mkdir(resources, { recursive: true });
for (const name of [
  "server",
  "shared",
  "electron",
  "dist",
  "package.json",
  "README.md",
])
  await fs.cp(path.join(root, name), path.join(resources, name), {
    recursive: true,
  });
// Server uses Node built-ins only. The bundled UI already contains its runtime dependencies.
const controlDir = path.join(stage, "DEBIAN");
await fs.mkdir(controlDir, { recursive: true });
await fs.writeFile(
  path.join(controlDir, "control"),
  `Package: ember-local\nVersion: ${version}\nSection: devel\nPriority: optional\nArchitecture: amd64\nMaintainer: xorxand <xorxand@users.noreply.github.com>\nHomepage: https://github.com/xorxand/ember\nDepends: git, ripgrep, libgtk-3-0, libnss3, libxss1, libgbm1, libasound2 | libasound2t64, libatk-bridge2.0-0, libdrm2, libxkbcommon0, libx11-xcb1, libxcomposite1, libxdamage1, libxrandr2, libxfixes3, libxext6\nDescription: Local AI workspace powered by Ollama\n Projects, tasks, model discovery and downloads, streaming chat, and coding tools.\n`,
);
await fs.chmod(path.join(appDir, "chrome-sandbox"), 0o4755);
await fs.writeFile(
  path.join(controlDir, "postinst"),
  "#!/bin/sh\nset -e\nchown root:root /opt/ember/chrome-sandbox\nchmod 4755 /opt/ember/chrome-sandbox\nif command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q || true; fi\n",
  { mode: 0o755 },
);
await fs.mkdir(path.join(stage, "usr/bin"), { recursive: true });
await fs.symlink("/opt/ember/ember", path.join(stage, "usr/bin/ember"));
await fs.mkdir(path.join(stage, "usr/share/applications"), { recursive: true });
await fs.writeFile(
  path.join(stage, "usr/share/applications/ember-local.desktop"),
  "[Desktop Entry]\nType=Application\nName=Ember\nComment=Local AI workspace powered by Ollama\nExec=/opt/ember/ember %U\nIcon=ember-local\nTerminal=false\nCategories=Development;Utility;\nStartupWMClass=Ember\n",
);
const iconDir = path.join(stage, "usr/share/icons/hicolor/scalable/apps");
await fs.mkdir(iconDir, { recursive: true });
await fs.copyFile(
  path.join(root, "electron/icon.svg"),
  path.join(iconDir, "ember-local.svg"),
);
const output = path.join(release, `ember-local_${version}_amd64.deb`);
execFileSync(
  "dpkg-deb",
  ["--root-owner-group", "-Zgzip", "-z6", "--build", stage, output],
  { stdio: "inherit" },
);
await fs.rm(stage, { recursive: true, force: true });
console.log("Created:", output);
