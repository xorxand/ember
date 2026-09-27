# Ember 1.3.0

Model pickers now show Agent verified, Tool use unreliable, Chat only, or Untested. Agent mode ranks verified models first and explains the selected model's reliability without preventing selection.

Initial assessments are tied to the exact tested weights: qwen3.5:4b passed basic tool checks; qwen2.5:1.5b repeatedly returned prose without executing tools. Updating a model resets its assessment to Untested unless that digest has evidence. Model size is not used to judge reliability. Verification does not guarantee success on every task. New models are not automatically tested.

Close Ember and install `sudo apt install ./ember-local_1.3.0_amd64.deb`, then reopen it. Existing data is retained.

The source archive includes the built UI and requires Node.js 24 or newer. Run `node server/index.mjs` from the extracted ember folder. Checksums are included in SHA256SUMS.
