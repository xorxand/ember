# Ember 1.2.0

Chat and Agent replies now show message timing below the response:

- **Started:** when your message was sent.
- **First response:** when the first response text or tool call arrived.
- **Response finished:** when the response completed.
- **Elapsed:** time from sending your message to response completion, including queueing and approval waits. This updates live during generation.

User messages also show their sent time. Timestamps use your local timezone; hover to see the full date and timezone. Timing persists with conversation history. Stopped and failed streams are labeled accurately, and historical completion times are never guessed.

## Install

Close Ember, then install:

```sh
sudo apt install ./ember-local_1.2.0_amd64.deb
```

Reopen Ember. Existing conversations, models, and approval policies are retained. Detailed timing is recorded for new responses.

The `ember-1.2.0.tar.gz` asset includes the built browser UI. Extract it, enter `ember`, and run `node server/index.mjs` using Node.js 24 or newer. GitHub automatic source archives require `npm ci && npm run build` first. Both assets have hashes in `SHA256SUMS`.

All 34 backend tests, the timing browser workflow, and the standard browser workflows passed. System-wide installation is not verified on this host.
