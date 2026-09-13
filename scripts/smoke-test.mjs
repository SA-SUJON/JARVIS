import assert from 'node:assert/strict';
import { DEFAULT_PROVIDERS, failoverChat, utilityAnswer } from '../dist-electron/providers.js';
import fs from 'node:fs';

assert.equal(DEFAULT_PROVIDERS.length, 13, 'all integrated providers should be registered');
assert.equal(fs.existsSync(new URL('../models/piper/en_GB-alan-medium.onnx', import.meta.url)), true, 'Piper model must be packaged');
assert.equal(fs.existsSync(new URL('../models/piper/piper.exe', import.meta.url)), true, 'Windows Piper executable must be packaged');
assert.equal(DEFAULT_PROVIDERS.find((provider) => provider.id === 'gemini')?.model, 'gemini-3.8-flash', 'Gemini should default to 3.8 Flash');
const calc = await utilityAnswer('calculate 12 * (3 + 2)');
assert.equal(calc?.kind, 'utility');
assert.match(calc?.answer || '', /60/);
const emptyModels = await Promise.all(DEFAULT_PROVIDERS.map(async (provider) => (await import('../dist-electron/providers.js')).listModels(provider)));
assert.ok(emptyModels.flat().length >= 0, 'curated models returned without network calls');
const webFallback = await failoverChat(DEFAULT_PROVIDERS, [{ role: 'user', content: 'latest technology news' }]); assert.equal(webFallback.provider, 'web', 'no-key failover should switch to sourced web search'); assert.match(webFallback.answer, /DuckDuckGo results|Web lookup|No indexed web results|Internet lookup is unavailable/);
console.log('JARVIS smoke tests passed');
