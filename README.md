# Ember

A Codex-inspired local AI workspace powered by Ollama. Projects and multiple tasks share one quiet desktop interface, with a built-in model library for discovering, downloading, updating, and selecting open-weight models.

## Run it

### Browser workspace — quickest start

Requires **Node.js 24 or newer**. The release source includes a prebuilt interface; the server uses only Node built-ins:

```bash
cd ember
node server/index.mjs
```

Open **http://127.0.0.1:4317**. Set `PORT` to change the port. Stop with Ctrl+C. Project folders can be added by absolute path.

### Linux desktop package

The Debian/Ubuntu x64 package is in `release/ember-local_0.1.0_amd64.deb`.

```bash
sudo apt install ./release/ember-local_0.1.0_amd64.deb
ember
```

Installation needs administrator access because Electron's Chromium sandbox helper must be owned by root. The package configures the helper at `/opt/ember/chrome-sandbox`; sandboxing is kept enabled. On Linux distributions restricting unprivileged namespaces, launching an unpackaged Electron executable can fail until a proper package is installed. Use the browser workspace in the meantime. Do not add `--no-sandbox` to a normal launcher.

### Develop the desktop app

```bash
npm ci
npm run desktop
```

`npm run build` compiles the React UI. `npm start` starts the local service. For frontend development, run `npm run dev` in one terminal (build watcher) and `npm start` in another, then reload the browser after changes. `npm run package:linux` builds the Debian package with the bundled Electron runtime.

## What's implemented

- **Projects and tasks:** connect real folders, persistent conversation history, task rename, archive/restore, search, per-project instructions and model defaults. Each task independently selects Chat or Agent mode and an installed model.
- **Streaming chat:** native Ollama streaming, Markdown rendering, code blocks, copy response, text attachments, output token/speed metrics, cancellation, and context-budget handling.
- **Coding agent:** list/read project files, propose complete file changes, inspect a before/after diff, approve or reject each write and command, capture terminal output, and continue the agent loop with tool results. Up to 12 model steps per turn.
- **Model discovery:** a live, searchable Ollama library with capabilities, parameter variants, size and context metadata. Popularity/name/recent-update sorting, cached catalog, model-card/license links, and manual pulls by exact model name.
- **Installed model management:** local/cloud distinction, default selection, license/details inspection, unload from memory, remove with confirmation, and registry fingerprint checks for updates. Updates never silently replace models in queued or active tasks.
- **Downloads:** streaming layer progress, one-at-a-time queue, pause/resume using Ollama's cached layers, errors/retry, completed history, and refresh of installed models after completion. Download state survives app restarts.
- **Ollama setup:** detects existing installations and running servers; reuses existing models; starts a stopped local server on request. A Linux x64/ARM64 installer downloads an app-owned runtime from the official Ollama download host without root access. Other platforms link to the official installer.
- **Workspace controls:** execution concurrency (default 1), generation temperature/context, custom Ollama endpoint, dark/light themes, file browser, a project command console, native folder picker in desktop mode, and Ctrl/Cmd+N / Ctrl/Cmd+K shortcuts.

## Local data and privacy

The browser launch stores workspace JSON in `.data/` next to this README. The desktop package stores it in its Electron user-data directory, generally `~/.config/Ember/workspace` (exact casing follows Electron's app name). Override either with `EMBER_DATA_DIR=/absolute/folder`. User data contains conversation content, project paths, file proposals, and settings. It is written atomically with owner-only file permissions, without encryption. Back up the data folder while Ember is closed.

Ollama owns the actual model weights. Ember reuses the model store of the connected server. Deleting a model removes its Ollama reference; shared layers may remain. The model-size total is not a physical disk-usage measurement because layers can be shared.

No analytics, account, cloud chat fallback, or third-party fonts are used. Model discovery and update checks contact `ollama.com` / `registry.ollama.ai`; downloads use Ollama's registry flow. If you explicitly configure a remote Ollama endpoint, prompts and attached/project content used by the agent are sent to that server.

## Security boundaries

The backend binds only to `127.0.0.1`, checks the Host and Origin, rejects cross-site requests, and requires a random session token on every API call. The UI is served with a restrictive Content Security Policy. Electron has context isolation, no renderer Node integration, and a narrowly scoped native folder-picker bridge. Rendered Markdown is sanitized; external links open separately.

File tools enforce the real project root, including symlink checks; parent traversal, `.git`, common credential files, and binary/oversized reads are blocked. Absolute file paths are accepted only when they stay inside the project. An approved write checks the original content fingerprint before applying so it cannot silently overwrite a file changed since review.

**Shell commands are not OS-sandboxed.** An approved agent command, or a command you enter directly in the terminal, runs with your user permissions and can access files outside the project. Commands show their exact text and working folder before agent approval, have a 60-second timeout, and support cancellation. The terminal is a command runner rather than a full interactive PTY.

## Validation

```bash
npm test               # backend/unit/integration suite using an isolated mock Ollama
npm run test:ui        # Playwright flows against isolated fixtures
node tests/live-smoke.mjs  # opt-in: real Ollama, qwen3.5:0.8b already installed
```

The UI suite needs Playwright's Chromium (`npx playwright install chromium` if not already installed). Test workspaces are temporary and cleaned afterward. Live smoke creates a temporary project, exercises chat and a file-reading tool, checks the registry fingerprint, and pulls an already-installed model. Set `EMBER_TEST_MODEL` to use another installed model; the agent check needs tool support. Live smoke actually uses local compute and may update the specified model tag.

## Preview limitations

- Linux x64 is the packaged target. macOS and Windows builds/signing have not been prepared or tested.
- Ollama's public library has no stable documented discovery API used here. The catalog adapter parses the public library and tags pages, with cached data and manual model-name pulls as fallbacks if the markup changes. The initial catalog is empty until its first successful fetch.
- Automatic runtime installation is implemented, but was not executed on this machine because Ollama was already installed. GPU driver and optional AMD ROCm installation are outside the app's installer. It downloads the official runtime over HTTPS, without independent release-signature verification.
- Model memory fit is a heuristic using system RAM and estimated overhead, not GPU/VRAM profiling. Large models may still fail to load. Ollama errors appear in the task.
- Text attachments only; no image/PDF ingestion, RAG index, web tools, MCP plugins, or interactive terminal programs yet.
- Agent reliability varies by model. Models must advertise tool support for Agent mode. Tool errors and step limits remain visible in the transcript.
- Interrupted turns are retained and marked after restart; generation does not automatically resume. Paused downloads resume when requested.
- There is no Git worktree isolation for simultaneous tasks editing the same project. Stale-write checks catch file changes between proposal and approval, but shell commands require care.
- Storage is a versioned JSON document. For very large histories, a database and incremental event protocol would be a sensible next step.

## Structure

- `src/` — React workspace and styling
- `server/index.mjs` — loopback HTTP API, auth, event stream, static UI
- `server/agent.mjs` — task queue, streaming agent loop, approval gates
- `server/projects.mjs` — file boundaries, stale-write checks, command runner
- `server/ollama.mjs` — native API adapter and runtime discovery
- `server/catalog.mjs` — live catalog, variants, manifest fingerprints
- `server/downloads.mjs` — persistent download queue
- `server/installer.mjs` — app-owned Linux Ollama installation
- `server/store.mjs` — atomic local persistence and restart recovery
- `electron/` — desktop window, native bridge, app icon
- `tests/` — controlled fixtures, backend/UI/live smoke tests

Technical references: [Ollama API](https://docs.ollama.com/api), [Ollama model library](https://ollama.com/library), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
