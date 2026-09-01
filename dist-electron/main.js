import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EdgeTTS } from 'node-edge-tts';
import { DEFAULT_PROVIDERS, failoverChat, listModels, utilityAnswer } from './providers.js';
import { getCoreDiagnostics, getNetworkStatus, getDeviceIdentity, runAdb, getAdbStatus, currentLocation, getWeather, searchLocation, getSystemLogs } from './system.js';
import { cleanForSpeech } from './speech.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
let voiceListener = null;
let sttStopping = false;
let voiceListenerLastError = '';
const settingsPath = () => path.join(app.getPath('userData'), 'jarvis-settings-integrated.json');
const faceProfilesPath = () => path.join(app.getPath('userData'), 'jarvis-face-profiles.bin');
const audioPath = (extension) => path.join(app.getPath('temp'), `jarvis-response.${extension}`);
function normalizeFaceProfile(input) {
    const displayName = String(input?.displayName || '').replace(/[\r\n]/g, ' ').trim().slice(0, 80);
    const relation = input?.relation === 'family' ? 'family' : 'operator';
    const greeting = String(input?.greeting || (relation === 'operator' ? 'Hi Boss.' : `Hello, ${displayName}.`)).replace(/[\r\n]/g, ' ').trim().slice(0, 180);
    const facts = {
        age: Number.isFinite(Number(input?.facts?.age)) ? Math.max(0, Math.min(150, Number(input.facts.age))) : null,
        work: String(input?.facts?.work || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120),
        notes: String(input?.facts?.notes || '').replace(/[\r\n]/g, ' ').trim().slice(0, 240)
    };
    const embeddings = Array.isArray(input?.embeddings) ? input.embeddings.map((row) => Array.isArray(row) ? row.map(Number).filter((value) => Number.isFinite(value)).slice(0, 128) : []).filter((row) => row.length === 128).slice(0, 8) : [];
    const voiceEmbeddings = Array.isArray(input?.voiceEmbeddings) ? input.voiceEmbeddings.map((row) => Array.isArray(row) ? row.map(Number).filter((value) => Number.isFinite(value)).slice(0, 256) : []).filter((row) => row.length === 256).slice(0, 8) : [];
    if (!displayName || !embeddings.length)
        throw new Error('A profile name and at least one valid 128-value face embedding are required.');
    const now = new Date().toISOString();
    return { id: String(input?.id || `face-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80), displayName, relation, greeting, facts, embeddings, voiceEmbeddings, createdAt: String(input?.createdAt || now), updatedAt: now };
}
async function readFaceProfiles() {
    if (!safeStorage.isEncryptionAvailable())
        return [];
    try {
        const encoded = await fs.readFile(faceProfilesPath(), 'utf8');
        const decrypted = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
        const parsed = JSON.parse(decrypted);
        return Array.isArray(parsed) ? parsed.map(normalizeFaceProfile) : [];
    }
    catch {
        return [];
    }
}
async function writeFaceProfiles(profiles) {
    if (!safeStorage.isEncryptionAvailable())
        throw new Error('OS secure storage is unavailable; biometric profiles were not persisted.');
    const encoded = safeStorage.encryptString(JSON.stringify(profiles.slice(0, 12))).toString('base64');
    await fs.mkdir(path.dirname(faceProfilesPath()), { recursive: true });
    await fs.writeFile(faceProfilesPath(), encoded, 'utf8');
}
const VOICE_PROFILES = { natural: { edgeRate: '-2%', edgePitch: '-1%', piperNoise: '0.58', piperLength: '1.02', piperNoiseW: '0.72', sentenceSilence: '0.18' }, classic: { edgeRate: '-4%', edgePitch: '-3%', piperNoise: '0.56', piperLength: '1.05', piperNoiseW: '0.68', sentenceSilence: '0.24' }, deep: { edgeRate: '-5%', edgePitch: '-7%', piperNoise: '0.50', piperLength: '1.08', piperNoiseW: '0.62', sentenceSilence: '0.28' } };
async function envDefaults() { const candidates = [path.join(app.getAppPath(), '.env'), path.join(process.resourcesPath, '.env'), path.join(process.cwd(), '.env')]; for (const file of candidates) {
    try {
        const text = await fs.readFile(file, 'utf8');
        const values = {};
        for (const line of text.split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
            if (match)
                values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
        return { assistantName: values.Assistantname || 'JARVIS', userName: values.Username || 'SA SUJON', language: values.InputLanguage || 'en', voice: values.AssistantVoice || 'en-CA-LiamNeural', legacyKeys: { CohereAPIKey: values.CohereAPIKey || undefined, GroqAPIKey: values.GroqAPIKey || undefined, HuggingFaceAPIKey: values.HuggingFaceAPIKey || undefined } };
    }
    catch { /* try next location */ }
} return { assistantName: 'JARVIS', userName: 'SA SUJON', language: 'en', voice: 'en-CA-LiamNeural', legacyKeys: {} }; }
function decryptSecret(value) { return value && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : undefined; }
function encryptSecret(value) { return value && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : undefined; }
function resolvePythonRoot() { const packagedRoot = path.join(process.resourcesPath, 'jarvis-python'); const sourceRoot = path.join(app.getAppPath(), 'references', 'jarvisai'); return existsSync(packagedRoot) ? packagedRoot : sourceRoot; }
async function syncPythonEnv(settings) { const envPath = path.join(resolvePythonRoot(), '.env'); try {
    let content = await fs.readFile(envPath, 'utf8');
    const values = { InputLanguage: settings.language, Assistantname: settings.assistantName, Username: settings.userName };
    for (const [key, value] of Object.entries(values)) {
        const safeValue = value.replace(/[\r\n]/g, ' ').trim();
        const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, 'mi');
        if (pattern.test(content))
            content = content.replace(pattern, `$1${safeValue}`);
        else
            content += `${content.endsWith('\\n') ? '' : '\\n'}${key} = ${safeValue}\\n`;
    }
    await fs.writeFile(envPath, content, 'utf8');
}
catch { /* packaged resources may be read-only; bundled defaults remain usable */ } }
let pythonBridge = null;
let pythonBridgeBuffer = '';
let pythonBridgeCounter = 0;
let telemetryTimer = null;
let telemetryInFlight = false;
const pythonPending = new Map();
async function publishTelemetry() {
    if (telemetryInFlight || !mainWindow || mainWindow.isDestroyed())
        return;
    telemetryInFlight = true;
    try {
        const [diagnostics, network, identity] = await Promise.allSettled([getCoreDiagnostics(), getNetworkStatus(), getDeviceIdentity()]);
        mainWindow?.webContents.send('system:telemetry', {
            diagnostics: diagnostics.status === 'fulfilled' ? diagnostics.value : { telemetrySource: 'TELEMETRY_ERROR', error: diagnostics.reason instanceof Error ? diagnostics.reason.message : String(diagnostics.reason) },
            network: network.status === 'fulfilled' ? network.value : null,
            identity: identity.status === 'fulfilled' ? identity.value : null,
            collectedAt: new Date().toISOString()
        });
    }
    finally {
        telemetryInFlight = false;
    }
}
function rejectPythonPending(error) { for (const [id, pending] of pythonPending) {
    clearTimeout(pending.timer);
    pending.reject(error);
    pythonPending.delete(id);
} }
function bridgeConfig(settings) { return { providers: settings.providers, language: settings.language, voice: settings.voice, assistantName: settings.assistantName, userName: settings.userName }; }
async function operatorProfileContext() {
    const operator = (await readFaceProfiles()).find((profile) => profile.relation === 'operator');
    if (!operator)
        return '';
    const details = [operator.facts.age != null ? `Age: ${operator.facts.age}` : '', operator.facts.work ? `Work: ${operator.facts.work}` : '', operator.facts.notes ? `Notes: ${operator.facts.notes}` : ''].filter(Boolean).join('; ');
    return `Known operator profile: ${operator.displayName}.${details ? ` ${details}.` : ''} Use this only when relevant and do not reveal private profile data unnecessarily.`;
}
function ensurePythonBridge() { if (pythonBridge)
    return pythonBridge; const root = resolvePythonRoot(); const script = path.join(root, 'Backend', 'ElectronBridge.py'); if (!existsSync(script))
    throw new Error(`Python capability bridge not found at ${script}`); const preferred = process.env.JARVIS_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe'); const executable = existsSync(preferred) ? preferred : 'python'; pythonBridge = spawn(executable, ['-u', path.join('Backend', 'ElectronBridge.py')], { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); pythonBridge.stdout.setEncoding('utf8'); pythonBridge.stdout.on('data', (chunk) => { pythonBridgeBuffer += chunk; const lines = pythonBridgeBuffer.split(/\r?\n/); pythonBridgeBuffer = lines.pop() || ''; for (const line of lines) {
    try {
        const message = JSON.parse(line);
        const pending = pythonPending.get(message.id);
        if (!pending)
            continue;
        clearTimeout(pending.timer);
        pythonPending.delete(message.id);
        if (message.ok)
            pending.resolve(message.result);
        else
            pending.reject(new Error(message.error || 'Python capability failed'));
    }
    catch { /* protocol noise is forwarded on stderr by the bridge */ }
} }); pythonBridge.stderr.setEncoding('utf8'); pythonBridge.stderr.on('data', (chunk) => { const detail = String(chunk).trim(); if (detail)
    mainWindow?.webContents.send('python:error', detail); }); pythonBridge.once('error', (error) => { pythonBridge = null; rejectPythonPending(error); mainWindow?.webContents.send('python:error', error.message); }); pythonBridge.once('close', (code, signal) => { const error = new Error(`Python capability bridge exited (code=${code ?? 'unknown'}, signal=${signal ?? 'none'})`); pythonBridge = null; pythonBridgeBuffer = ''; rejectPythonPending(error); mainWindow?.webContents.send('python:stopped', { code, signal }); }); return pythonBridge; }
function rawPythonRequest(op, payload, timeoutMs = 120000) { const child = ensurePythonBridge(); const id = `python-${Date.now()}-${++pythonBridgeCounter}`; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pythonPending.delete(id); reject(new Error(`Python capability timeout: ${op}`)); }, timeoutMs); pythonPending.set(id, { resolve, reject, timer }); try {
    child.stdin.write(`${JSON.stringify({ id, op, ...(op === 'configure' ? { config: payload } : { payload }) })}\n`);
}
catch (error) {
    clearTimeout(timer);
    pythonPending.delete(id);
    reject(error instanceof Error ? error : new Error(String(error)));
} }); }
async function callPython(op, payload, settings, timeoutMs = 120000) { await rawPythonRequest('configure', bridgeConfig(settings), 20000); return await rawPythonRequest(op, payload, timeoutMs); }
async function imageDataUrls(files) { return await Promise.all(files.slice(0, 4).map(async (file) => { const absolute = path.resolve(file); const root = path.resolve(resolvePythonRoot()); if (!absolute.startsWith(`${root}${path.sep}`))
    return null; try {
    const buffer = await fs.readFile(absolute);
    const extension = path.extname(absolute).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
}
catch {
    return null;
} })).then((items) => items.filter((item) => Boolean(item))); }
function deterministicDecisions(query) { const clean = query.trim(); const match = clean.match(/^generate\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)$/i); if (match)
    return [`generate image ${match[1]}`]; if (/^(open|close|play|content|google search|youtube search|system)\s+/i.test(clean))
    return [clean]; return []; }
async function readSettings() {
    const defaults = await envDefaults();
    try {
        const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
        const legacyKeys = { CohereAPIKey: decryptSecret(raw.encryptedLegacyKeys?.CohereAPIKey) || defaults.legacyKeys.CohereAPIKey, GroqAPIKey: decryptSecret(raw.encryptedLegacyKeys?.GroqAPIKey) || defaults.legacyKeys.GroqAPIKey, HuggingFaceAPIKey: decryptSecret(raw.encryptedLegacyKeys?.HuggingFaceAPIKey) || defaults.legacyKeys.HuggingFaceAPIKey };
        const legacyByProvider = { cohere: legacyKeys.CohereAPIKey, groq: legacyKeys.GroqAPIKey, huggingface: legacyKeys.HuggingFaceAPIKey };
        const providers = (raw.providers?.length ? raw.providers : DEFAULT_PROVIDERS).map((p) => ({ ...p, key: decryptSecret(raw.encryptedKeys?.[p.id]) || legacyByProvider[p.id] }));
        return { providers, voice: raw.voice || defaults.voice, voiceProfile: raw.voiceProfile && raw.voiceProfile in VOICE_PROFILES ? raw.voiceProfile : 'natural', language: raw.language || defaults.language, wakeWord: raw.wakeWord ?? true, voiceEnabled: raw.voiceEnabled ?? true, assistantName: raw.assistantName || defaults.assistantName, userName: raw.userName || defaults.userName, legacyKeys };
    }
    catch {
        return { providers: DEFAULT_PROVIDERS, voice: defaults.voice, voiceProfile: 'natural', language: defaults.language, wakeWord: true, voiceEnabled: true, assistantName: defaults.assistantName, userName: defaults.userName, legacyKeys: defaults.legacyKeys };
    }
}
async function writeSettings(input) {
    const current = await readSettings();
    const providers = input.providers || current.providers;
    const encryptedKeys = {};
    const safeProviders = providers.map(({ key, ...p }) => { const encrypted = encryptSecret(key); if (encrypted)
        encryptedKeys[p.id] = encrypted; return p; });
    const legacyKeys = {};
    for (const key of ['CohereAPIKey', 'GroqAPIKey', 'HuggingFaceAPIKey']) {
        const encrypted = encryptSecret(input.legacyKeys?.[key] ?? current.legacyKeys[key]);
        if (encrypted)
            legacyKeys[key] = encrypted;
    }
    const nextSettings = { providers: safeProviders, encryptedKeys, encryptedLegacyKeys: legacyKeys, voice: input.voice ?? current.voice, voiceProfile: input.voiceProfile ?? current.voiceProfile, language: input.language ?? current.language, wakeWord: input.wakeWord ?? current.wakeWord, voiceEnabled: input.voiceEnabled ?? current.voiceEnabled, assistantName: input.assistantName ?? current.assistantName, userName: input.userName ?? current.userName };
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(settingsPath(), JSON.stringify(nextSettings, null, 2));
    await syncPythonEnv({ language: nextSettings.language, assistantName: nextSettings.assistantName, userName: nextSettings.userName });
}
function createWindow() {
    mainWindow = new BrowserWindow({ width: 1480, height: 960, minWidth: 1080, minHeight: 720, backgroundColor: '#080c12', frame: false, titleBarStyle: 'hidden', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' } });
    if (isDev)
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    else
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}
async function spawnSpeech(command, args, input, cwd) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, cwd });
        let error = '';
        child.stderr.on('data', (d) => { error += d.toString(); });
        if (input) {
            child.stdin.write(input);
            child.stdin.end();
        }
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || `Speech process exited with ${code}`)));
    });
}
async function audioDataUrl(file) { const mime = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'; const buffer = await fs.readFile(file); return `data:${mime};base64,${buffer.toString('base64')}`; }
async function localSpeech(text, profile) {
    const packagedRoot = path.join(process.resourcesPath, 'models');
    const root = existsSync(packagedRoot) ? process.resourcesPath : app.getAppPath();
    const piper = process.platform === 'win32' ? path.join(root, 'models', 'piper', 'piper.exe') : path.join(root, 'models', 'piper', 'piper');
    const piperModel = path.join(root, 'models', 'piper', 'en_GB-alan-medium.onnx');
    if (existsSync(piper) && existsSync(piperModel)) {
        await spawnSpeech(piper, ['--model', piperModel, '--output_file', audioPath('wav'), '--noise_scale', profile.piperNoise, '--length_scale', profile.piperLength, '--noise_w', profile.piperNoiseW, '--sentence_silence', profile.sentenceSilence], text, path.dirname(piper));
        return audioPath('wav');
    }
    const kokoroScript = existsSync(path.join(process.resourcesPath, 'kokoro_synth.py')) ? path.join(process.resourcesPath, 'kokoro_synth.py') : path.join(app.getAppPath(), 'public', 'kokoro_synth.py');
    const kokoroModel = path.join(root, 'models', 'kokoro', 'kokoro-v1.0.onnx');
    const kokoroVoices = path.join(root, 'models', 'kokoro', 'voices-v1.0.bin');
    if (existsSync(kokoroScript) && existsSync(kokoroModel) && existsSync(kokoroVoices)) {
        const python = process.env.JARVIS_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
        const pythonArgs = process.platform === 'win32' ? ['-3.12', kokoroScript] : [kokoroScript];
        await spawnSpeech(python, [...pythonArgs, '--model', kokoroModel, '--voices', kokoroVoices, '--voice', 'af_sarah', '--output', audioPath('wav')], text, path.dirname(kokoroScript));
        return audioPath('wav');
    }
    throw new Error('Offline voice models are not installed. Add Piper under models/piper or Kokoro under models/kokoro.');
}
app.whenReady().then(() => {
    createWindow();
    ipcMain.handle('system:telemetry-request', () => publishTelemetry());
    void publishTelemetry();
    telemetryTimer = setInterval(() => { void publishTelemetry(); }, 15000);
    ipcMain.handle('settings:get', () => readSettings());
    ipcMain.handle('settings:set', (_event, input) => writeSettings(input));
    ipcMain.handle('face-profiles:list', () => readFaceProfiles());
    ipcMain.handle('face-profiles:save', async (_event, input) => {
        const next = normalizeFaceProfile(input);
        const profiles = await readFaceProfiles();
        const withoutExisting = profiles.filter((profile) => profile.id !== next.id);
        await writeFaceProfiles([...withoutExisting, next]);
        return next;
    });
    ipcMain.handle('face-profiles:delete', async (_event, id) => {
        const profiles = await readFaceProfiles();
        await writeFaceProfiles(profiles.filter((profile) => profile.id !== String(id)));
        return true;
    });
    ipcMain.handle('face-profiles:clear', async () => { await writeFaceProfiles([]); return true; });
    ipcMain.handle('models:list', async (_event, provider) => listModels(provider));
    ipcMain.handle('system:diagnostics', () => getCoreDiagnostics());
    ipcMain.handle('system:network', () => getNetworkStatus());
    ipcMain.handle('system:identity', () => getDeviceIdentity());
    ipcMain.handle('system:adb', (_event, commandLine) => runAdb(commandLine));
    ipcMain.handle('system:adb-status', () => getAdbStatus());
    ipcMain.handle('system:location', () => currentLocation());
    ipcMain.handle('system:weather', (_event, latitude, longitude) => getWeather(latitude, longitude));
    ipcMain.handle('system:map-search', (_event, query) => searchLocation(query));
    ipcMain.handle('system:logs', () => getSystemLogs());
    ipcMain.handle('assistant:query', async (_event, input) => {
        const identity = await readSettings();
        const utility = await utilityAnswer(input.query);
        if (utility)
            return { ...utility, provider: 'utility', attempts: [] };
        const profileContext = await operatorProfileContext();
        const system = { role: 'system', content: `You are ${identity.assistantName}, a warm, natural, technically capable AI assistant. Address the operator as ${identity.userName}. Speak like a thoughtful human colleague with a calm, lightly witty presence. Use the requested language when practical, contractions, varied sentence rhythm, and short conversational paragraphs. Answer directly first, then add only useful context. Do not sound like a status report. Avoid repetitive canned openings, excessive headings, bullet overload, markdown decorations, or narrating reasoning. When spoken aloud, keep it easy to listen to. Be precise and transparent about uncertainty.${profileContext ? ` ${profileContext}` : ''}` };
        let decisions = [];
        if (identity.providers.some((provider) => provider.id === 'cohere' && provider.key && provider.enabled)) {
            try {
                decisions = (await callPython('classify', { prompt: input.query }, identity, 45000)).decisions || [];
            }
            catch { /* the existing Electron router remains the fallback when Cohere/Python classification is unavailable */ }
        }
        if (!decisions.length)
            decisions = deterministicDecisions(input.query);
        const imageCommand = decisions.find((item) => item.toLowerCase().startsWith('generate image '));
        if (imageCommand) {
            try {
                const generated = await callPython('image', { prompt: imageCommand.slice('generate image '.length).trim(), count: 4 }, identity, 180000);
                const images = await imageDataUrls(generated.files || []);
                return { kind: 'image', answer: `Generated ${images.length || generated.files?.length || 0} image(s) for “${generated.prompt}”.`, provider: 'jarvisai-image-generation', attempts: [], images };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { kind: 'image', answer: `Image generation failed: ${message}`, provider: 'jarvisai-image-generation', attempts: [message] };
            }
        }
        const executable = decisions.filter((item) => /^(open|close|play|content|google search|youtube search|system)\s+/i.test(item));
        if (executable.length) {
            try {
                const automation = await callPython('automate', { commands: executable }, identity, 120000);
                const results = Array.isArray(automation?.results) ? automation.results : [];
                const summary = results.map((item) => `${item.ok ? 'OK' : 'FAILED'}: ${item.target || item.action}${item.detail ? ` — ${item.detail}` : ''}`).join('\n');
                return { kind: 'action', answer: summary || `Automation dispatched: ${executable.join('; ')}`, provider: 'jarvisai-automation', attempts: results.filter((item) => !item.ok).map((item) => item.detail || item.action) };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { kind: 'action', answer: `Local automation failed: ${message}`, provider: 'jarvisai-automation', attempts: [message] };
            }
        }
        if (decisions.some((item) => item.toLowerCase().startsWith('realtime ')) && identity.providers.some((provider) => provider.id === 'groq' && provider.key && provider.enabled)) {
            try {
                const query = decisions.filter((item) => /^(general|realtime)\s+/i.test(item)).map((item) => item.split(/\s+/).slice(1).join(' ')).join(' and ');
                return { kind: 'realtime', answer: (await callPython('realtime', { prompt: [query || input.query, profileContext].filter(Boolean).join('\n\n') }, identity, 120000)).answer, provider: 'jarvisai-realtime-search', attempts: [] };
            }
            catch { /* fall through to the stronger Electron multi-provider/web failover */ }
        }
        if (decisions.some((item) => item.toLowerCase().startsWith('general ')) && identity.providers.some((provider) => provider.id === 'groq' && provider.key && provider.enabled)) {
            try {
                const query = decisions.find((item) => item.toLowerCase().startsWith('general '))?.replace(/^general\s+/i, '') || input.query;
                return { kind: 'ai', answer: (await callPython('chat', { prompt: [query, profileContext].filter(Boolean).join('\n\n') }, identity, 120000)).answer, provider: 'jarvisai-chatbot', attempts: [] };
            }
            catch { /* fall through to the Electron provider failover */ }
        }
        return { kind: 'ai', ...(await failoverChat(input.providers, [system, ...(input.history || []).slice(-8), { role: 'user', content: input.query }], input.preferred)) };
    });
    ipcMain.handle('python:capability', async (_event, input) => { const settings = await readSettings(); return await callPython(input.operation, input.payload || {}, settings, input.operation === 'image' ? 180000 : 120000); });
    ipcMain.handle('voice:status', () => {
        const root = existsSync(path.join(process.resourcesPath, 'models')) ? process.resourcesPath : app.getAppPath();
        const piperReady = existsSync(path.join(root, 'models', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper')) && existsSync(path.join(root, 'models', 'piper', 'en_GB-alan-medium.onnx'));
        const kokoroScript = existsSync(path.join(process.resourcesPath, 'kokoro_synth.py')) ? path.join(process.resourcesPath, 'kokoro_synth.py') : path.join(app.getAppPath(), 'public', 'kokoro_synth.py');
        const kokoroReady = existsSync(path.join(root, 'models', 'kokoro', 'kokoro-v1.0.onnx')) && existsSync(path.join(root, 'models', 'kokoro', 'voices-v1.0.bin')) && existsSync(kokoroScript);
        const packagedPythonRoot = path.join(process.resourcesPath, 'jarvis-python');
        const sourcePythonRoot = path.join(app.getAppPath(), 'references', 'jarvisai');
        const pythonRoot = existsSync(packagedPythonRoot) ? packagedPythonRoot : sourcePythonRoot;
        const sttScript = path.join(pythonRoot, 'Backend', 'SpeechToText.py');
        return { nativeListen: existsSync(sttScript), piper: piperReady, kokoro: kokoroReady, edge: true, note: 'Chrome/Selenium Python SpeechToText.py is the only STT engine.' };
    });
    ipcMain.handle('stt:start', async (_event, language = 'en') => {
        if (voiceListener)
            return { available: true, running: true };
        const packagedRoot = path.join(process.resourcesPath, 'jarvis-python');
        const sourceRoot = path.join(app.getAppPath(), 'references', 'jarvisai');
        const pythonRoot = existsSync(packagedRoot) ? packagedRoot : sourceRoot;
        const script = path.join(pythonRoot, 'Backend', 'SpeechToText.py');
        if (!existsSync(script))
            return { available: false, reason: `Chrome/Selenium STT script not found at ${script}.` };
        const savedSettings = await readSettings();
        await syncPythonEnv({ language, assistantName: savedSettings.assistantName, userName: savedSettings.userName });
        const preferredPython = process.env.JARVIS_PYTHON || path.join(pythonRoot, '.venv', 'Scripts', 'python.exe');
        const command = existsSync(preferredPython) ? preferredPython : 'python';
        voiceListenerLastError = '';
        sttStopping = false;
        voiceListener = spawn(command, ['-u', path.join('Backend', 'SpeechToText.py')], { cwd: pythonRoot, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', JARVIS_INPUT_LANGUAGE: language } });
        let buffer = '';
        voiceListener.stdout.setEncoding('utf8');
        voiceListener.stdout.on('data', (chunk) => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) {
            const transcript = line.trim();
            if (transcript)
                mainWindow?.webContents.send('stt:transcript', transcript);
        } });
        voiceListener.stderr.setEncoding('utf8');
        voiceListener.stderr.on('data', (chunk) => { voiceListenerLastError = String(chunk).trim(); if (voiceListenerLastError)
            mainWindow?.webContents.send('stt:error', `Python STT: ${voiceListenerLastError}`); });
        voiceListener.once('close', (code, signal) => { const stoppedIntentionally = sttStopping; const reason = voiceListenerLastError || `Python Chrome/Selenium STT exited (code=${code ?? 'unknown'}, signal=${signal ?? 'none'}).`; voiceListener = null; sttStopping = false; if (!stoppedIntentionally)
            mainWindow?.webContents.send('stt:error', reason); mainWindow?.webContents.send('stt:stopped'); });
        voiceListener.once('error', (error) => { voiceListenerLastError = error.message; voiceListener = null; mainWindow?.webContents.send('stt:error', `Python STT launch failed: ${error.message}`); });
        mainWindow?.webContents.send('stt:ready', { culture: language, recognizer: 'Chrome/Selenium Python SpeechToText.py' });
        return { available: true, running: true };
    });
    ipcMain.handle('stt:status', () => ({ running: Boolean(voiceListener), script: path.join(resolvePythonRoot(), 'Backend', 'SpeechToText.py') }));
    ipcMain.handle('stt:stop', () => { if (voiceListener) {
        sttStopping = true;
        voiceListener.kill();
    } return true; });
    ipcMain.handle('voice:speak', async (_event, input) => {
        const profile = input.voiceProfile && input.voiceProfile in VOICE_PROFILES ? VOICE_PROFILES[input.voiceProfile] : VOICE_PROFILES.natural;
        const speechText = cleanForSpeech(input.text);
        if (!speechText)
            return { source: 'unavailable', error: 'No speakable text remained after speech formatting cleanup.' };
        try {
            const locale = input.voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] || (input.language && input.language.includes('-') ? input.language : 'en-US');
            const tts = new EdgeTTS({ voice: input.voice, lang: locale, outputFormat: 'audio-24khz-48kbitrate-mono-mp3', pitch: profile.edgePitch, rate: profile.edgeRate, volume: '+0%', timeout: 10000 });
            await tts.ttsPromise(speechText, audioPath('mp3'));
            return { source: 'edge-tts', file: audioPath('mp3'), dataUrl: await audioDataUrl(audioPath('mp3')) };
        }
        catch (onlineError) {
            try {
                const file = await localSpeech(speechText, profile);
                return { source: 'piper/kokoro', file, dataUrl: await audioDataUrl(file) };
            }
            catch (offlineError) {
                try {
                    const settings = await readSettings();
                    const generated = await callPython('tts', { text: speechText, voice: input.voice }, settings, 30000);
                    return { source: 'jarvisai-python-edge-tts', file: generated.file, dataUrl: await audioDataUrl(generated.file) };
                }
                catch (pythonError) {
                    return { source: 'unavailable', error: `${onlineError instanceof Error ? onlineError.message : onlineError}; ${offlineError instanceof Error ? offlineError.message : offlineError}; ${pythonError instanceof Error ? pythonError.message : pythonError}` };
                }
            }
        }
    });
    ipcMain.handle('system:open-url', (_event, url) => { if (/^https?:\/\//i.test(url))
        return shell.openExternal(url); return false; });
    ipcMain.handle('system:request-elevation', () => { if (process.platform !== 'win32')
        return false; spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process powershell.exe -Verb RunAs'], { windowsHide: false }); return true; });
    ipcMain.handle('window:minimize', () => mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
    ipcMain.handle('window:close', () => mainWindow?.close());
});
app.on('window-all-closed', () => { if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
} if (voiceListener) {
    sttStopping = true;
    voiceListener.kill();
} if (pythonBridge) {
    pythonBridge.kill();
    pythonBridge = null;
    rejectPythonPending(new Error('Python capability bridge stopped with the application'));
} if (process.platform !== 'darwin')
    app.quit(); });
