import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const input = fs.readFileSync(path.join(root, 'references', 'listofvoicesavailableinEdgeTTS.txt'), 'utf8').split(/\r?\n/);
const voices = [];
for (let index = 0; index < input.length; index += 1) {
  if (!input[index].startsWith('ShortName:')) continue;
  const voice = { id: input[index].replace(/^ShortName:\s*/, '').trim(), name: '', gender: '', locale: '', personalities: [], categories: [] };
  for (let cursor = Math.max(0, index - 1); cursor <= Math.min(input.length - 1, index + 4); cursor += 1) {
    const line = input[cursor];
    if (line.startsWith('Name:')) voice.name = line.replace(/^Name:\s*/, '').trim();
    if (line.startsWith('Gender:')) voice.gender = line.replace(/^Gender:\s*/, '').trim();
    if (line.startsWith('Locale:')) voice.locale = line.replace(/^Locale:\s*/, '').trim();
    if (line.startsWith('VoiceTag:')) { const content = line.match(/ContentCategories'?: \[([^\]]*)\].*VoicePersonalities'?: \[([^\]]*)\]/); if (content) { voice.categories = content[1].split(',').map((item) => item.replace(/[\[\]'" ]/g, '')).filter(Boolean); voice.personalities = content[2].split(',').map((item) => item.replace(/[\[\]'" ]/g, '')).filter(Boolean); } }
  }
  voices.push(voice);
}
const unique = Array.from(new Map(voices.map((voice) => [voice.id, voice])).values()).sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(root, 'src', 'edgeVoices.ts'), `export const EDGE_VOICES = ${JSON.stringify(unique, null, 2)} as const;\nexport type EdgeVoice = typeof EDGE_VOICES[number];\n`);
console.log(`Parsed ${unique.length} unique Edge TTS voices.`);
