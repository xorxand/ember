# Ember 1.4.0

Ember now supports fully local voice dictation. Click the microphone beside the message field, speak, then stop recording. The transcript is inserted at the cursor for review before it is sent. Escape cancels recording, a visible timer shows when the microphone is active, and recordings are limited to five minutes.

The Debian package and source archive include the official Linux x64 whisper.cpp 1.9.4 runtime. Speech weights are downloaded separately in **Settings → Local dictation**, with progress, cancellation, deletion, and SHA-256 verification. Available choices are fast English (`tiny.en`), balanced English (`base.en`, default), accurate English (`small.en`), and multilingual balanced (`base`). Audio and transcription stay on the computer and temporary recordings are deleted immediately afterward.

Electron grants microphone access only to Ember's own loopback origin and continues to deny camera access and untrusted origins. The browser workspace supports the same feature on localhost with browser permission.

Close Ember and install:

```sh
sudo apt install ./ember-local_1.4.0_amd64.deb
```

Existing conversations, Ollama models, projects, settings, and approval policies are retained. Download a speech model after installing, then use the microphone in any task.

Validation covers 37 backend tests, 13 standard browser workflows, a dedicated dictation browser workflow, the native Electron shell, and a real bundled whisper.cpp transcription using checksum-verified `tiny.en` weights. System-wide package installation was not performed on the build host.
