# Ember 1.1.1

Agent turns can now run for up to **100 model-response rounds**, increased from 12. A round can contain multiple tool calls; execution-check retries also count. The settings help text and limit message use the same shared limit as the backend.

The repository is now **xorxand/ember**. History, tags, and existing releases are preserved. Repository links and Debian package metadata have been updated.

## Install

Close Ember and install the downloaded package:

```sh
sudo apt install ./ember-local_1.1.1_amd64.deb
```

Reopen Ember to use the new limit. Your conversations and approval policies are retained.

Alternatively, extract `ember-1.1.1.tar.gz`, enter the `ember` folder, and run `node server/index.mjs` with Node.js 24 or newer. This release asset includes the built UI. GitHub automatic source archives need `npm ci && npm run build` first. Download checksums are in `SHA256SUMS`.

All 32 backend tests passed, including an agent that continued beyond 12 rounds and stopped at exactly 100. System-wide package installation remains unverified on this host.
