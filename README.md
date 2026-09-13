# Ember

A Codex-inspired local AI workspace powered by Ollama. Projects and multiple tasks share one quiet desktop interface, with a built-in model library for discovering, downloading, updating, and selecting open-weight models.

## Run it

### Browser workspace — quickest start

Requires **Node.js 24 or newer**. The `ember-1.1.0.tar.gz` release asset includes a prebuilt interface; the server uses only Node built-ins:

```bash
cd localmodel
node server/index.mjs
```

Open **http://127.0.0.1:4317**. Set `PORT` to change the port. Stop with Ctrl+C. Project folders can be added by absolute path.

Cloning the repository instead? Run `npm ci` and `npm run build` before starting the server. GitHub’s automatic source archives also need this build step.

### Linux desktop package

Download the Debian/Ubuntu x64 package from [Releases](https://github.com/xorxand/localmodel/releases/tag/1.1.0). Local builds place it in `release/ember-local_1.1.0_amd64.deb`.

```bash
sudo apt install ./release/ember-local_1.1.0_amd64.deb
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
- **Coding agent:** fast literal code search, file-name search, declaration lookup, bounded line excerpts, list/read project files, propose complete file changes, inspect a before/after diff, control automatic versus reviewed writes and commands, capture terminal output, and continue the agent loop with tool results. Up to 12 model steps per turn.
- **Model discovery:** a live, searchable Ollama library with capabilities, parameter variants, size and context metadata. Popularity/name/recent-update sorting, cached catalog, model-card/license links, and manual pulls by exact model name.
- **Installed model management:** local/cloud distinction, default selection, license/details inspection, unload from memory, remove with confirmation, and registry fingerprint checks for updates. Updates never silently replace models in queued or active tasks.
- **Downloads:** streaming layer progress, one-at-a-time queue, pause/resume using Ollama's cached layers, errors/retry, completed history, and refresh of installed models after completion. Download state survives app restarts.
- **Ollama setup:** detects existing installations and running servers; reuses existing models; starts a stopped local server on request. A Linux x64/ARM64 installer downloads an app-owned runtime from the official Ollama download host without root access. Other platforms link to the official installer.
- **Workspace controls:** execution concurrency (default 1), generation temperature/context, custom Ollama endpoint, dark/light themes, file browser, a project command console, native folder picker in desktop mode, and Ctrl/Cmd+N / Ctrl/Cmd+K shortcuts.

## Chat and Agent mode

Use **Chat** for conversation. It cannot edit files or execute commands. Choose **Agent** in the composer (or **Enable Agent** below it) to do work. If the task has no project, select an existing project or add a local folder. Your messages and draft stay in the same task; send the next instruction to begin, since old requests are not replayed. Agent requires a model with tool support and uses the configured approval policy for writes and commands (Ask every time by default). It checks for unfinished work with at most two automatic follow-ups per turn. Final replies show actual tool activity; no-tool responses explicitly say that no files or commands were affected. Advertised tool support does not guarantee reliable execution. Commands can also create or modify files, so the separate file-approval count only covers direct file-tool changes.

## Approval policies

In an Agent task, click **Approvals** below the message box. Choose a task override or **Use project default**. Set the project default from its overview → **Project settings** → **Approval mode**. Existing projects default to **Ask every time** until you change them.

- **Ask every time:** read tools run automatically; each write and shell command requires approval.
- **Ask for risky or unknown:** ordinary source/text edits run automatically. Shell commands require approval unless their entire text matches an explicitly trusted command (leading/trailing whitespace is ignored). Configure up to 40 exact commands, one per line. Entries have no prefix or wildcard matching; if you explicitly trust a compound shell command, the entire command is authorized. Builds/tests execute current project code and can have effects beyond the project folder.
- **Always run:** agent writes and commands run without per-action approval. Commands have your user permissions and are not OS-sandboxed. Stop, timeouts, tool path boundaries, and stale-write checks remain active.

The middle mode permits common source/text extensions; scripts/configuration directories, dotfiles, known build/configuration files, shebang scripts, executable or symlinked targets, unknown types, and clearing an existing nonempty file require review. These are conservative rules, not a claim that source edits or trusted commands are harmless. An empty trusted list means every command prompts.

Settings persist locally and cannot change during an active task. Pending approvals are never silently converted by changing a policy. Automatic actions are labeled **Auto-approved** in tool results, with the policy decision recorded in history. Policies affect agent tools; manually entered terminal commands and **Apply to original project** remain explicit user actions.

## Local data and privacy

The browser launch stores workspace data in `.data/` next to this README. The desktop package uses `~/.config/Ember/workspace` on Linux. Override either with `EMBER_DATA_DIR=/absolute/folder`.

Ember uses **SQLite with WAL transactions**, separate task/message/approval rows, indexed full-text conversation search, and lazy history loading. An existing `workspace.json` is imported once and preserved unchanged alongside a `workspace.json.pre-sqlite` backup. Stop older Ember processes before migrating. To back up SQLite, close Ember and copy the data folder; while running, the `-wal` file may contain recent changes and must not be omitted. Data is local and owner-readable, without encryption. Use one Ember service per data folder.

The UI opens with at most 100 task summaries, fetches only the selected conversation, and sends incremental event patches during generation. Conversation history starts with 60 recent messages; use **Load earlier messages** for older pages. Task navigation has previous/next pages and server-side full-text search. The agent keeps a bounded recent history window, trimming complete turns to the context budget.

Ollama owns the actual model weights. Ember reuses the model store of the connected server. Deleting a model removes its Ollama reference; shared layers may remain. The model-size total is not a physical disk-usage measurement because layers can be shared.

No analytics, account, cloud chat fallback, or third-party fonts are used. Model discovery and update checks contact `ollama.com` / `registry.ollama.ai`; downloads use Ollama's registry flow. If you explicitly configure a remote Ollama endpoint, prompts and attached/project content used by the agent are sent to that server.

## Security boundaries

The backend binds only to `127.0.0.1`, checks the Host and Origin, rejects cross-site requests, and requires a random session token on every API call. The UI is served with a restrictive Content Security Policy. Electron has context isolation, no renderer Node integration, and a narrowly scoped native folder-picker bridge. Rendered Markdown is sanitized; external links open separately.

File tools enforce the real project root, including symlink checks; parent traversal, `.git`, common credential files, and binary/oversized reads are blocked. Absolute file paths are accepted only when they stay inside the project. An approved write checks the original content fingerprint before applying so it cannot silently overwrite a file changed since review.

**Shell commands are not OS-sandboxed.** An approved agent command, or a command you enter directly in the terminal, runs with your user permissions and can access files outside the project. Commands show their exact text and working folder before agent approval, have a 60-second timeout, and support cancellation. The terminal is a command runner rather than a full interactive PTY.

## Validation

```bash
npm test               # backend/unit/integration suite using an isolated mock Ollama
npm run test:ui        # existing Playwright workflows
npm run test:approval-ui # approval modes, project defaults, overrides, audit and persistence
npm run test:agent-setup-ui # chat-to-agent setup, preserved history/draft, approved writes
npm run test:scaling-ui # history paging, repository search, worktree review/apply
node tests/live-smoke.mjs  # opt-in: real Ollama, qwen3.5:0.8b already installed
```

The UI suite needs Playwright's Chromium (`npx playwright install chromium` if not already installed). Test workspaces are temporary and cleaned afterward. Live smoke creates a temporary project, exercises chat and a file-reading tool, checks the registry fingerprint, and pulls an already-installed model. Set `EMBER_TEST_MODEL` to use another installed model; the agent check needs tool support. Live smoke actually uses local compute and may update the specified model tag.

## Known limitations

- Linux x64 is the packaged target. macOS and Windows builds/signing have not been prepared or tested.
- Ollama's public library has no stable documented discovery API used here. The catalog adapter parses the public library and tags pages, with cached data and manual model-name pulls as fallbacks if the markup changes. The initial catalog is empty until its first successful fetch.
- Automatic runtime installation is implemented, but was not executed on this machine because Ollama was already installed. GPU driver and optional AMD ROCm installation are outside the app's installer. It downloads the official runtime over HTTPS, without independent release-signature verification.
- Model memory fit is a heuristic using system RAM and estimated overhead, not GPU/VRAM profiling. Large models may still fail to load. Ollama errors appear in the task.
- Text attachments only; no image/PDF ingestion, RAG index, web tools, MCP plugins, or interactive terminal programs yet.
- Agent reliability varies by model. Models must advertise tool support for Agent mode. Tool errors and step limits remain visible in the transcript.
- Interrupted turns are retained and marked after restart; generation does not automatically resume. Paused downloads resume when requested.
- Git agent tasks use isolated worktrees and branches from committed HEAD. Uncommitted source changes are deliberately not copied. Non-Git project agents run one at a time in their original folder. An initial Git commit is required for isolation.
- **Review all changes** in the Changes panel includes modified, deleted, new, and task-committed files. **Apply to original project** validates the reviewed patch fingerprint and requires the original checkout to be clean at the same base commit; it leaves applied changes uncommitted. If the original branch has advanced, integrate the task branch with normal Git tools. Worktrees and branches are retained, including after archive, to avoid losing unfinished work.
- Declaration lookup recognizes common function/class/type definitions heuristically. It is not a language-server or semantic dependency index. Repository search uses ripgrep when available (included as a Linux package dependency); a bounded fallback is available, but does not implement Git ignore rules. Search results explicitly report when limits are reached.
- SQLite removes full-history rewrites, but task metadata is still held in memory. This is not a distributed/multi-user service. Search, line excerpts, history pages, and stream buffers are bounded; no claim is made of unlimited repository size or model context.

## Structure

- `src/` — React workspace and styling
- `server/index.mjs` — loopback HTTP API, auth, event stream, static UI
- `server/agent.mjs` — task queue, streaming agent loop, approval gates
- `server/projects.mjs` — file boundaries, stale-write checks, command runner
- `server/ollama.mjs` — native API adapter and runtime discovery
- `server/catalog.mjs` — live catalog, variants, manifest fingerprints
- `server/downloads.mjs` — persistent download queue
- `server/installer.mjs` — app-owned Linux Ollama installation
- `server/store.mjs` — SQLite migration, normalized persistence, full-text history search, and paging
- `server/workspaces.mjs` — isolated Git branches, review, and guarded apply
- `server/search.mjs` — ripgrep search, bounded fallback, and line retrieval
- `shared/state-patches.js` — incremental server/UI update protocol
- `electron/` — desktop window, native bridge, app icon
- `tests/` — controlled fixtures, backend/UI/live smoke tests

Technical references: [Ollama API](https://docs.ollama.com/api), [Ollama model library](https://ollama.com/library), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
