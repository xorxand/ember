# Ember 1.0.1

Agent mode is now visible in every conversation, and the agent checks its tool results before treating a prose reply as its final answer. Previously, tasks without a project showed only Chat, and models could give instructions for work without actually doing it.

- Select Agent or click Enable Agent, then choose an existing project or add a local folder.
- Keep the same conversation and unsent draft when enabling Agent. Previous requests are not replayed.
- Agent checks for unfinished work with at most two automatic follow-ups per turn. It never executes code copied from a prose response.
- Final Agent responses show actual tool calls, applied file approvals, and successful commands. Responses with no tool calls explicitly say that nothing ran.
- Chat mode explicitly explains that it cannot edit files or run commands.
- Active and archived tasks cannot change their execution scope; existing project history cannot be reassigned to another folder.

Live verification: `qwen3.5:4b` created, compiled, and ran the requested Go countdown through approved commands, producing 10 through 1. `qwen2.5:1.5b` did not complete the same test reliably; use a stronger tool-capable model if the execution summary shows no useful work.

## Install

Download `ember-local_1.0.1_amd64.deb`, close Ember, and run:

```sh
sudo apt install ./ember-local_1.0.1_amd64.deb
```

Reopen Ember. Existing workspace data is retained. No model weights are bundled.

Alternatively, extract `ember-1.0.1.tar.gz`, enter `localmodel`, and run `node server/index.mjs` with Node.js 24 or newer. The release asset includes the built UI; GitHub automatic source archives need `npm ci && npm run build` first.

Both assets have hashes in `SHA256SUMS`. System-wide installation is not verified on this host; see VALIDATION.md for the test record.
