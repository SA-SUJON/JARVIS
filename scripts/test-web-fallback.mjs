import { webSearchAnswer } from '../dist-electron/providers.js';
const result = await webSearchAnswer('latest artificial intelligence model releases');
if (!result || result.kind !== 'search' || !/Source:|No indexed web results|Internet lookup is unavailable/.test(result.answer)) throw new Error('Web fallback did not return a sourced or explicit unavailable response');
console.log(JSON.stringify({ ok: true, preview: result.answer.slice(0, 500) }, null, 2));
