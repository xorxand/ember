import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Store } from '../server/store.mjs';
import { ndjson, modelName, validateEndpoint, isCloud } from '../server/ollama.mjs';
import { parseCatalog, parseTags } from '../server/catalog.mjs';
import { safePath, readFile, inspectWrite, applyWrite, listFiles, runCommand } from '../server/projects.mjs';

test('NDJSON handles split UTF-8, several messages per chunk, and unterminated last line', async () => {
  const data = Buffer.from('{"text":"🌋"}\n{"done":true}\n{"tail":1}'); const messages = [];
  for await (const value of ndjson(Readable.from([data.subarray(0, 11), data.subarray(11, 16), data.subarray(16)]))) messages.push(value);
  assert.deepEqual(messages, [{ text: '🌋' }, { done: true }, { tail: 1 }]);
});
test('model and endpoint validation rejects traversal, credentials, and shell text', () => {
  assert.equal(modelName('qwen3.5'), 'qwen3.5:latest'); assert.equal(modelName('someone/model:4b-q4'), 'someone/model:4b-q4');
  for (const bad of ['../../foo', 'a;touch foo', 'x:$(id)', '', '-bad', 'x\ny']) assert.throws(() => modelName(bad));
  assert.equal(validateEndpoint('http://localhost:11434/'), 'http://localhost:11434');
  for (const bad of ['file:///etc/passwd', 'https://user:pass@localhost', 'http://localhost/api']) assert.throws(() => validateEndpoint(bad));
  assert.equal(isCloud({ remote_host: 'https://ollama.com' }), true); assert.equal(isCloud({ name: 'test:cloud' }), true); assert.equal(isCloud({ name: 'qwen3.5:4b' }), false);
});
test('catalog and tags parsing extracts only actual model entries and local variant sizes', () => {
  const html = '<a href="/library/foo"><h2>Foo</h2><p>A &amp; B</p><span>tools</span><span>4b</span><span>2.3M</span><span title="Sep 1, 2026 10:00 PM UTC">Updated</span><span>1 week ago</span></a><a href="/library/bar">Navigation</a>';
  assert.deepEqual(parseCatalog(html).map(m => [m.name, m.description, m.capabilities, m.sizes]), [['foo', 'A & B', ['tools'], ['4b']]]);
  const tags = parseTags('<a href="/library/foo:4b">foo:4b abcdef123456 • 3.4GB • 128K context window</a><a href="/library/foo:4b">duplicate</a><a href="/library/foo:cloud">cloud</a>', 'foo');
  assert.equal(tags.length, 2); assert.equal(tags[0].size, 3.4e9); assert.equal(tags[0].context, '128K'); assert.equal(tags[1].cloud, true);
});
test('project tools enforce root boundaries, secret exclusions, and stale-write checks', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-path-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'test.txt'), 'original'); await fs.writeFile(path.join(dir, 'outside.txt'), 'secret'); await fs.symlink(path.join(dir, 'outside.txt'), path.join(root, 'escape')); await fs.symlink(dir, path.join(root, 'outdir'));
  for (const value of ['../outside.txt', '/etc/passwd', '.env', '.git/config', 'escape', 'outdir/new.txt']) await assert.rejects(safePath(root, value, { write: true }));
  const proposal = await inspectWrite(root, 'test.txt', 'replacement'); assert.equal(await readFile(root, 'test.txt'), 'original'); await applyWrite(root, proposal); assert.equal(await readFile(root, 'test.txt'), 'replacement'); await assert.rejects(applyWrite(root, proposal), /changed since/);
  const create = await inspectWrite(root, 'nested/new.txt', 'new'); await applyWrite(root, create); assert.equal(await readFile(root, 'nested/new.txt'), 'new');
  assert.ok(!(await listFiles(root)).some(f => f.name === 'escape')); await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 2, 3])); await assert.rejects(readFile(root, 'binary'), /Binary/);
});
test('workspace restart retains history and interrupts active work without replaying approval', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-store-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); const store = new Store(dir); const task = store.addTask(); task.status = 'approval'; task.messages.push({ role: 'user', content: 'test' }); task.approvals.push({ id: 'a', status: 'pending' }); store.data.downloads.push({ status: 'downloading' }); store.touch();
  const next = new Store(dir); assert.equal(next.data.tasks[0].status, 'interrupted'); assert.equal(next.data.tasks[0].messages[0].content, 'test'); assert.equal(next.data.tasks[0].approvals[0].status, 'interrupted'); assert.equal(next.data.downloads[0].status, 'paused');
});
test('corrupt workspace is never overwritten', async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-corrupt-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); await fs.writeFile(path.join(dir, 'workspace.json'), '{broken'); assert.throws(() => new Store(dir)); assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), '{broken'); });
test('commands return exit status and enforce a timeout', async () => { const result = await runCommand(os.tmpdir(), 'printf hello; exit 3'); assert.equal(result.code, 3); assert.equal(result.output, 'hello'); const timeout = await runCommand(os.tmpdir(), 'sleep 10', { timeout: 50 }); assert.equal(timeout.timedOut, true); });
