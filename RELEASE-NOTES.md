# Ember 1.0.0

First published release of Ember, a local AI workspace powered by Ollama.

- Chat and coding tasks organized into projects, with streaming responses and per-task model selection.
- Browse, download, update, and manage local open-weight models; detect and reuse Ollama or install an app-owned Linux runtime.
- SQLite conversation storage, paginated history, full-text task search, and incremental UI updates.
- Repository text, file, and declaration search with targeted line excerpts.
- Isolated Git task worktrees, file and command approvals, and reviewed application to the original project.
- Linux x64 Debian package with bundled Electron runtime.

## Downloads

Install `ember-local_1.0.0_amd64.deb` with `sudo apt install ./ember-local_1.0.0_amd64.deb`. Launch Ember from the application menu or run `ember`.

For the browser workspace, extract `ember-1.0.0.tar.gz`, enter `localmodel`, and run `node server/index.mjs` with Node.js 24 or newer. Open http://127.0.0.1:4317. The release asset includes the built UI; GitHub’s automatic source archives require `npm ci && npm run build` first.

Verify downloads using `sha256sum -c SHA256SUMS` in the directory containing both assets.

## Known limitations

Linux x64 is the packaged target. System-wide installation has not been tested on this host. Declaration lookup is heuristic, shell commands run with the user’s permissions after approval, and agent quality depends on the selected model. See README.md and VALIDATION.md for details.
