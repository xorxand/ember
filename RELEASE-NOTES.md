# Ember 1.1.0

Choose how Agent tasks handle approvals, with project defaults and per-task overrides.

- **Ask every time:** approve each file write and shell command. This remains the default for existing projects.
- **Ask for risky or unknown:** automatically allow ordinary source/text edits and commands you explicitly trust by their full text. Scripts, configuration, executable/symlinked targets, unknown file types, and clearing nonempty files prompt for review. Unlisted commands always prompt.
- **Always run:** execute agent writes and commands without per-action prompts. Shell commands run with your user permissions; they are not OS-sandboxed.

Click **Approvals** below an Agent task’s message box. Set project defaults in **Project settings → Approval mode**. Task settings can inherit the project policy or override it.

Automatic actions remain visible in history. Cancellation, timeouts, file-tool boundaries, and stale-write checks remain enabled. Settings cannot change during active work, and pending approvals are not retroactively approved.

## Install

Close Ember, then install the downloaded package:

```sh
sudo apt install ./ember-local_1.1.0_amd64.deb
```

Reopen Ember. Existing conversations, models, and projects are retained. Existing projects keep Ask every time until you change their policy.

The `ember-1.1.0.tar.gz` asset includes the built browser interface. Extract it, enter `localmodel`, and run `node server/index.mjs` using Node.js 24 or newer. GitHub automatic source archives need `npm ci && npm run build` first. Both downloadable assets have hashes in `SHA256SUMS`.

See README.md for exact policy rules and VALIDATION.md for test evidence. System-wide Debian installation is not verified on this host.
