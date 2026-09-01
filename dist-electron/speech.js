const SPEECH_ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
/**
 * Convert an assistant response into natural prose for TTS only.
 * The original response must remain unchanged for the chat renderer.
 */
export function cleanForSpeech(text) {
    const withoutFormatting = String(text || '')
        .replace(/\*\*(.*?)\*\*/gs, '$1')
        .replace(/\*(.*?)\*/gs, '$1')
        .replace(/`(.*?)`/gs, '$1');
    let ordinalIndex = 0;
    return withoutFormatting.split(/\r?\n/).map((line) => {
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (numbered) {
            const ordinal = SPEECH_ORDINALS[ordinalIndex] || `${ordinalIndex + 1}th`;
            ordinalIndex += 1;
            return `${ordinal}, ${numbered[1]}`;
        }
        return line.replace(/^\s*[-•]\s+/, '');
    }).map((line) => line.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
