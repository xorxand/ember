import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-native-'));
// Test-only override for restricted CI hosts. Production launchers keep sandboxing enabled.
const app = await electron.launch({ args: ['--no-sandbox', '.'], env: { ...process.env, EMBER_DATA_DIR: dir }, timeout: 20000 });
try {
  const window = await app.firstWindow(); await window.getByRole('heading', { name: 'What will you build?' }).waitFor();
  const bridge = await window.evaluate(() => ({ folderPicker: typeof window.emberDesktop?.chooseFolder, require: typeof window.require }));
  assert.equal(bridge.folderPicker, 'function'); assert.equal(bridge.require, 'undefined');
  await window.locator('.main-nav button').filter({ hasText: 'Models' }).click(); await window.getByRole('heading', { name: 'Model library', exact: true }).waitFor();
  console.log('Native shell loads workspace and model library; isolated folder-picker bridge present; renderer Node access absent.');
} finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
