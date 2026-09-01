import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { app } from 'electron';

export type PythonEngineSettings = { enabled: boolean; ttsEngine: 'python-edge' | 'electron-edge'; userName: string; assistantName: string; inputLanguage: string; assistantVoice: string; apiKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } };

type PythonResponse = { ok: boolean; [key: string]: any };

function engineRoot() { const packaged = path.join(process.resourcesPath, 'python-engine'); return fs.existsSync(packaged) ? packaged : path.join(app.getAppPath(), 'python-engine'); }
function pythonCommand() { const root = engineRoot(); const candidates = process.platform === 'win32' ? [path.join(root, '.venv', 'Scripts', 'python.exe'), process.env.JARVIS_PYTHON || 'python'] : [path.join(root, '.venv', 'bin', 'python'), process.env.JARVIS_PYTHON || 'python3']; return candidates.find((candidate) => candidate && (candidate === process.env.JARVIS_PYTHON || fs.existsSync(candidate))) || candidates[candidates.length - 1]; }

export function pythonEngineStatus() { const root = engineRoot(); return { root, bridge: path.join(root, 'bridge.py'), python: pythonCommand(), installed: fs.existsSync(path.join(root, 'bridge.py')) } }

export async function callPython(action: string, settings: PythonEngineSettings, payload: Record<string, any> = {}, timeout = 45000): Promise<PythonResponse> {
  const status = pythonEngineStatus(); if (!status.installed) throw new Error(`Python JARVIS engine is not present at ${status.root}`);
  return await new Promise((resolve, reject) => {
    const child = spawn(status.python, [status.bridge], { cwd: status.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill(); reject(new Error(`Python engine timed out during ${action}`)); } }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.once('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); try { const parsed = JSON.parse(stdout.trim() || '{}') as PythonResponse; if (!parsed.ok && parsed.error) reject(new Error(`${parsed.error}${stderr ? ` — ${stderr.slice(0, 400)}` : ''}`)); else if (code !== 0) reject(new Error(parsed.error || stderr || `Python engine exited with ${code}`)); else resolve(parsed); } catch { reject(new Error(stderr || `Python engine returned invalid JSON: ${stdout.slice(0, 300)}`)); } });
    child.stdin.end(JSON.stringify({ action, settings, ...payload }));
  });
}
