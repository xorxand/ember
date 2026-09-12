import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const ignored = new Set(['node_modules', '.git', '.data', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
const sensitive = name => /^\.env(?:\.|$)/.test(name) || /^(id_rsa|id_ed25519|credentials|auth\.json)$/.test(name) || /\.(pem|key)$/.test(name);
export const hash = text => createHash('sha256').update(text).digest('hex');
export async function rootPath(value) { if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Enter an absolute project folder path.'); const root = await fs.realpath(value); if (!(await fs.stat(root)).isDirectory()) throw new Error('Project path must be a folder.'); return root; }
export async function safePath(root, relative, { write = false } = {}) {
  if (typeof relative !== 'string' || relative.includes('\0')) throw new Error('Use a path within the project.');
  const canonical = await fs.realpath(root);
  if (path.isAbsolute(relative)) relative = path.relative(canonical, relative);
  const parts = relative.split(/[\\/]/); if (parts.some(p => p === '..' || p === '.git' || sensitive(p))) throw new Error('This path is outside the allowed project files.');
  const candidate = path.resolve(canonical, relative);
  const inside = value => value === canonical || value.startsWith(canonical + path.sep);
  if (!inside(candidate)) throw new Error('Path escapes the project.');
  // Check every existing component, including the final symlink, before allowing a new file.
  let current = canonical;
  for (const part of path.relative(canonical, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const actual = await fs.realpath(current); if (!inside(actual)) throw new Error('Symlinks cannot escape the project.'); }
    catch (e) { if (e.code === 'ENOENT' && write) continue; throw e; }
  }
  return candidate;
}
export async function listFiles(root, relative = '') {
  const dir = await safePath(root, relative); const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => !ignored.has(e.name) && !sensitive(e.name) && !e.isSymbolicLink()).map(e => ({ name: e.name, path: path.posix.join(relative.replaceAll('\\', '/'), e.name), directory: e.isDirectory() })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).slice(0, 500);
}
export async function readFile(root, relative) {
  const target = await safePath(root, relative); const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 250_000) throw new Error('Only text files up to 250 KB can be opened.');
  const text = await fs.readFile(target, 'utf8'); if (text.includes('\0')) throw new Error('Binary files are not supported.'); return text;
}
export async function inspectWrite(root, relative, content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 250_000) throw new Error('File changes are limited to 250 KB.');
  await safePath(root, relative, { write: true });
  let before = null; try { before = await readFile(root, relative); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { path: relative, content, before, beforeHash: before === null ? null : hash(before) };
}
export async function applyWrite(root, change) {
  const target = await safePath(root, change.path, { write: true });
  let current = null; try { current = await readFile(root, change.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if ((current === null ? null : hash(current)) !== change.beforeHash) throw new Error('The file changed since this proposal. Reject it and ask the agent to read the latest version.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safePath(root, change.path, { write: true });
  await fs.writeFile(target, change.content, 'utf8'); return `Saved ${change.path}`;
}
export async function runCommand(root, command, { signal, onData = () => {}, timeout = 60000 } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.length > 8000) throw new Error('Enter a command under 8,000 characters.');
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], { cwd: root, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const stop = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill(); } catch {} setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} }, 1000).unref(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout); signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    const data = chunk => { output = (output + chunk.toString()).slice(-100000); onData(output); };
    child.stdout.on('data', data); child.stderr.on('data', data);
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.on('error', e => { finish(); reject(e); });
    child.on('close', code => { finish(); resolve({ code, output, timedOut, cancelled: Boolean(signal?.aborted) }); });
  });
}
