import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const root = process.cwd();
const entry = `${root}/dist-electron/main.js`;
const viteUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const deadline = Date.now() + 30000;

async function waitForReady() {
  while (Date.now() < deadline) {
    const fileReady = existsSync(entry);
    let viteReady = false;
    try {
      const response = await fetch(viteUrl);
      viteReady = response.ok;
    } catch {
      viteReady = false;
    }
    if (fileReady && viteReady) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Development prerequisites were not ready. Expected ${entry} and ${viteUrl}`);
}

try {
  await waitForReady();
  const command = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const child = spawn(command, ['.'], { cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: viteUrl }, stdio: 'inherit', windowsHide: false });
  child.on('error', (error) => { console.error(`Electron launch failed: ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
