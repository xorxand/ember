# Validation record — September 12, 2026

## Passed

- Production UI build: Vite, 19 transformed modules; no build errors.
- 16 backend/unit/integration tests: stream framing and split UTF-8; model/endpoint validation; live-page parser fixtures; project traversal/symlink/secret protections; stale-write checks; atomic persistence and interrupted-work recovery; corrupt-store protection; command output/exit/timeout; token and Host/Origin checks; streaming task queue/cancellation; approve/reject/stop behavior; real file writes after approval; command approval; download pause/resume/errors; atomic invalid settings.
- 12 Playwright browser workflows: initial workspace; model search and variant download; installed/update status; cancel deletion; add project; streaming coding task with diff review and file application; terminal output; file browser; archive/restore; settings/theme; reload persistence; 1000-pixel desktop layout without overflow. No browser page errors.
- Native Electron smoke: workspace and model library render; the folder-picker bridge is present; window.require is unavailable. A **test-only --no-sandbox override** was required by the restricted host. Production launchers and package retain sandboxing.
- Live Ollama 0.31.2: discovered existing local and cloud entries, fetched 240 model families and 62 local qwen3.5 variants, verified the installed qwen3.5:0.8b registry fingerprint, streamed EMBER_READY, invoked read_file in a temporary project and correctly answered with its verification word, and completed a real pull of the already-current model.
- Visual inspection: 1440×1000 dark workspace/model library, modal details, settings, and narrower desktop layout. Screenshots use actual local model inventory; controlled UI tests use isolated fixtures.

## Not verified on this host

- Installing the Debian package system-wide: requires administrator access to configure Electron's sandbox helper. Package contents and modes are inspected, but a normal installed launch remains to be checked after installation.
- Fresh Ollama installation: implementation was not executed because this machine already has Ollama. It supports an app-owned Linux x64/ARM64 runtime download; optional ROCm packages and OS GPU drivers are not installed.
- macOS/Windows packaging, signing, and native dialogs on those platforms.
- Large-model memory behavior, image/PDF ingestion, long-running interactive terminals, and cross-platform native installation.

The running preview's workspace data is separate from test fixtures. Test projects and their files are removed after tests. Existing Ollama model weights were reused; no extra large model was downloaded for testing.

## Version 0.2 — scaling changes (September 13)

- Migrated a fixture with **120 tasks and 28,800 messages** into normalized SQLite storage. Confirmed legacy backup preservation, zero eagerly loaded conversation caches, 100-summary paging, 60-message history pages without overlap, and full-text hits from older messages. Updating one streamed answer wrote only that message row.
- Verified incremental immutable patches, including text appends, new messages, and deletion. A five-character append to a 50,000-character answer plus one new message produced under 350 bytes of patches.
- Verified two Git agents awaiting review concurrently in distinct worktrees. Source files remained unchanged until explicit apply. Confirmed refusal on dirty original checkout and stale review fingerprints, and preservation of the other task's files.
- Verified repository text/file/declaration search, Git-ignore and secret exclusions, symlink boundaries, and bounded line excerpts. A separate synthetic **5,000-file** text-search run found the target in **17 ms** with ripgrep on this host. This is a small-file smoke benchmark, not a universal performance guarantee.
- Added a browser workflow covering older-message loading, isolated edits, repository search with excerpts, and reviewed application back to the original project.

Declaration lookup remains heuristic; language-server symbol/reference indexing is a future extension. SQLite in the bundled Node 24 runtime currently emits an experimental-API warning. No external database or native npm database extension is needed.

## Version 1.0.0 release — September 13, 2026

Revalidated from the repository at its new location:

- All 21 backend/unit/integration tests passed.
- Production UI build passed (20 modules).
- All 12 standard browser workflows passed with no browser page errors.
- Scaling browser workflow passed: history paging, Git isolation, repository search/excerpts, and reviewed apply.
- Linux amd64 Debian package built successfully; version metadata, launcher, shared modules, and root-owned mode 4755 sandbox helper verified.

System-wide package installation is still unverified on this host.

Native Electron smoke also passed under Xvfb (virtual display), using the existing test-only sandbox override; production packaging keeps sandboxing enabled.

## Version 1.0.1 — Agent setup (September 13, 2026)

- All 24 backend/unit/integration tests passed, including chat-to-agent conversion, retained conversation history, no automatic request replay, and invalid/active/archived task guards.
- New Agent setup browser workflow passed: visible Agent option without a project, cancellation, adding a folder, retaining history and draft, explicit write approval and actual file creation, choosing an existing project, and switching modes.
- All 12 existing browser workflows and the scaling workflow passed with no reported browser errors.
- Production UI and Linux amd64 Debian package rebuilt. System-wide installation remains unverified.

- Added deterministic recovery tests: a prose-only answer followed by actual approved writes; a missing command recovered after a write; and bounded no-tool replies explicitly labeled as response-only.
- Live Ollama `qwen3.5:4b` executed the exact countdown request in a temporary project: approved source-file creation, approved `go build -o count_down count_down.go && ./count_down`, exit code 0, and output 10 through 1. The resulting executable was independently rerun and produced the same output. The user’s project was not modified.
- A live `qwen2.5:1.5b` run called a build command before creating source, then failed to recover. Tool capability metadata alone does not establish model reliability.
