import { EdgeTTS } from 'node-edge-tts';
import fs from 'node:fs/promises';

const output = '/tmp/jarvis-edge-tts-test.mp3';
const tts = new EdgeTTS({ voice: 'en-GB-RyanNeural', lang: 'en-GB', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', timeout: 15000 });
await tts.ttsPromise('JARVIS voice synthesis test complete.', output);
const stat = await fs.stat(output);
console.log(JSON.stringify({ output, bytes: stat.size }));
