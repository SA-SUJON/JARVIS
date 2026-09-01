import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd();
const require = createRequire(import.meta.url);
const checks = [];
try { const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); checks.push({ name: 'package.json', ok: true, detail: `${packageJson.name}@${packageJson.version}` }); } catch (error) { checks.push({ name: 'package.json', ok: false, detail: String(error) }); }
for (const dependency of ['electron', 'systeminformation', 'node-edge-tts']) { try { const version = require(`${dependency}/package.json`).version; checks.push({ name: dependency, ok: true, detail: version }); } catch { checks.push({ name: dependency, ok: false, detail: 'missing — run npm install' }); } }
for (const file of ['dist/index.html', 'dist-electron/main.js', 'dist-electron/system.js', 'references/jarvisai/Backend/ElectronBridge.py', 'references/jarvisai/Backend/Automation.py', 'references/jarvisai/Backend/Chatbot.py', 'references/jarvisai/Backend/ImageGeneration.py', 'references/jarvisai/Backend/Model.py', 'references/jarvisai/Backend/RealtimeSearchEngine.py', 'references/jarvisai/Backend/SpeechToText.py', 'references/jarvisai/Backend/TextToSpeech.py']) checks.push({ name: file, ok: fs.existsSync(path.join(root, file)), detail: fs.existsSync(path.join(root, file)) ? 'present' : 'missing — restore the supplied Python backend' });
console.table(checks);
if (checks.some((check) => !check.ok)) process.exitCode = 1;
