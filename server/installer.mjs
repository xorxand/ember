import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createZstdDecompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
export class Installer {
  constructor(store, ollama) { this.store = store; this.ollama = ollama; this.status = { state: 'idle' }; this.controller = null; this.child = null; this.root = path.join(store.directory, 'runtime'); const local = path.join(this.root, 'bin', 'ollama'); if (fs.existsSync(local)) process.env.OLLAMA_BINARY = local; }
  async start() {
    if (this.controller) throw new Error('Installation is already running.');
    if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Automatic runtime installation currently supports Linux x64 and ARM64. Install Ollama from ollama.com/download, then reconnect.');
    if ((await this.ollama.detect()).installed) throw new Error('Ollama is already installed. Use Start Ollama instead.');
    this.controller = new AbortController(); this.status = { state: 'downloading', completed: 0, total: 0, detail: 'Downloading Ollama from ollama.com' }; this.store.emit('change');
    this.install().catch(e => { this.status = { ...this.status, state: 'failed', detail: e.message }; }).finally(() => { this.controller = null; this.child = null; this.store.emit('change'); });
    return this.status;
  }
  async install() {
    const signal = this.controller.signal; const arch = process.arch === 'x64' ? 'amd64' : 'arm64'; await fsp.mkdir(this.root, { recursive: true });
    const archive = path.join(this.root, 'ollama.tar.zst');
    const response = await fetch(`https://ollama.com/download/ollama-linux-${arch}.tar.zst`, { signal });
    if (!response.ok) throw new Error(`Ollama download returned ${response.status}.`);
    this.status.total = Number(response.headers.get('content-length')) || 0;
    const file = fs.createWriteStream(archive); let writeError = null; file.on('error', e => { writeError = e; });
    try { for await (const chunk of response.body) { if (writeError) throw writeError; if (!file.write(chunk)) await once(file, 'drain'); this.status.completed += chunk.length; this.store.emit('change'); } file.end(); await once(file, 'finish'); }
    catch (e) { file.destroy(); await fsp.rm(archive, { force: true }); throw e; }
    this.status.state = 'extracting'; this.status.detail = 'Installing a private runtime for Ember'; this.store.emit('change');
    this.child = spawn('tar', ['-xf', '-', '-C', this.root], { stdio: ['pipe', 'ignore', 'pipe'], signal });
    let output = ''; this.child.stderr.on('data', d => { output = (output + d).slice(-4000); });
    const extraction = new Promise((resolve, reject) => { this.child.on('error', reject); this.child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Could not extract Ollama. Ensure tar is installed. ${output}`))); });
    await Promise.all([pipeline(fs.createReadStream(archive), createZstdDecompress(), this.child.stdin, { signal }), extraction]);
    await fsp.rm(archive, { force: true }); process.env.OLLAMA_BINARY = path.join(this.root, 'bin', 'ollama');
    this.status = { state: 'complete', detail: 'Ollama installed. Starting the local server…' }; this.store.emit('change');
    await this.ollama.start(); this.status.detail = 'Ollama is ready';
  }
  cancel() { this.controller?.abort(); }
}
