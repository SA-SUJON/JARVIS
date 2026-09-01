export const DEFAULT_PROVIDERS = [
    { id: 'openai', name: 'ChatGPT / OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: true, priority: 1 },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.6-flash', enabled: true, priority: 2 },
    { id: 'anthropic', name: 'Claude / Anthropic', baseUrl: 'https://api.anthropic.com', enabled: true, priority: 3 },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: true, priority: 4 },
    { id: 'xai', name: 'Grok / xAI', baseUrl: 'https://api.x.ai/v1', enabled: true, priority: 5 },
    { id: 'qwen', name: 'Qwen / DashScope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', enabled: true, priority: 6 },
    { id: 'kimi', name: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.ai/v1', enabled: true, priority: 7 },
    { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', enabled: true, priority: 8 },
    { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', enabled: true, priority: 9 },
    { id: 'manus', name: 'Manus / Custom', baseUrl: 'https://api.manus.ai/v1', enabled: true, priority: 10 },
    { id: 'groq', name: 'Groq / Imported Backend', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', enabled: true, priority: 11 },
    { id: 'cohere', name: 'Cohere / Imported Router', baseUrl: 'https://api.cohere.com', model: 'command-a-03-2025', enabled: true, priority: 12 },
    { id: 'huggingface', name: 'Hugging Face / Imported Backend', baseUrl: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.1-8B-Instruct', enabled: true, priority: 13 }
];
const isQuotaLike = (status) => [401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
const join = (base, path) => `${base.replace(/\/$/, '')}${path}`;
const htmlText = (value) => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export async function webSearchAnswer(query) {
    const cleanQuery = query.trim();
    if (!cleanQuery)
        return null;
    try {
        const instant = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=0`, { headers: { 'User-Agent': 'JARVIS/1.0 web-search' } });
        const instantJson = instant.ok ? await instant.json() : {};
        const html = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, { headers: { 'User-Agent': 'Mozilla/5.0 JARVIS/1.0' } }).then((response) => response.ok ? response.text() : '');
        const hits = [];
        const resultPattern = /class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = resultPattern.exec(html)) && hits.length < 6) {
            const rawUrl = htmlText(match[1]);
            let url = rawUrl;
            try {
                const parsed = new URL(rawUrl, 'https://html.duckduckgo.com');
                url = parsed.searchParams.get('uddg') || rawUrl;
            }
            catch { /* keep raw URL */ }
            if (!/^https?:\/\//i.test(url))
                continue;
            const title = htmlText(match[2]);
            const start = match.index;
            const body = html.slice(start, start + 1800);
            const snippetMatch = body.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
            const snippet = htmlText(snippetMatch?.[1] || '');
            if (title && !hits.some((hit) => hit.url === url))
                hits.push({ title, url, snippet });
        }
        const lines = [`Web lookup for “${cleanQuery}”.`];
        if (instantJson.AbstractText)
            lines.push(`${instantJson.Heading ? `${instantJson.Heading}: ` : ''}${instantJson.AbstractText}${instantJson.AbstractURL ? `\nSource: ${instantJson.AbstractURL}` : ''}`);
        hits.forEach((hit, index) => lines.push(`\n${index + 1}. ${hit.title}\n${hit.snippet || 'Open the source for the full result.'}\nSource: ${hit.url}`));
        if (lines.length === 1)
            return { kind: 'search', answer: `No indexed web results were returned for “${cleanQuery}”. Try a more specific query.` };
        lines.push('\nThis is a source-backed web lookup. JARVIS did not invent a synthesis after AI links were exhausted; open the cited sources to verify time-sensitive or conflicting claims.');
        return { kind: 'search', answer: lines.join('\n') };
    }
    catch (error) {
        return { kind: 'search', answer: `Internet lookup is unavailable right now: ${error instanceof Error ? error.message : String(error)}` };
    }
}
function headers(provider) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key ?? ''}` };
}
async function responseError(res) {
    const text = await res.text().catch(() => '');
    return `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 180)}` : ''}`;
}
export async function listModels(provider) {
    if (!provider.key)
        return [];
    if (provider.id === 'gemini') {
        const res = await fetch(`${join(provider.baseUrl, '/models')}?key=${encodeURIComponent(provider.key)}`);
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return (json.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => ({ id: (m.baseModelId || m.name.replace(/^models\//, '')), label: m.displayName || m.name, provider: provider.id, context: m.inputTokenLimit, capabilities: m.supportedGenerationMethods }));
    }
    if (provider.id === 'cohere') {
        const res = await fetch(join(provider.baseUrl, '/v2/models'), { headers: { Authorization: `Bearer ${provider.key}` } });
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return (json.models ?? []).map((m) => ({ id: m.name || m.id || '', label: m.name || m.id || '', provider: provider.id })).filter((m) => m.id);
    }
    if (provider.id === 'anthropic') {
        const res = await fetch(join(provider.baseUrl, '/v1/models?limit=1000'), { headers: { 'x-api-key': provider.key, 'anthropic-version': '2023-06-01' } });
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id, provider: provider.id, created: m.created_at, context: m.max_input_tokens }));
    }
    const res = await fetch(join(provider.baseUrl, '/models'), { headers: headers(provider) });
    if (!res.ok)
        throw new Error(await responseError(res));
    const json = await res.json();
    return (json.data ?? []).map((m) => ({ id: m.id, label: m.id, provider: provider.id, created: m.created, capabilities: [m.owned_by || provider.name] }));
}
export async function chat(provider, messages, model, signal) {
    if (!provider.key)
        throw new Error('API key not configured');
    if (provider.id === 'gemini') {
        const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const system = messages.find((m) => m.role === 'system')?.content;
        const res = await fetch(`${join(provider.baseUrl, `/models/${model}:generateContent`)}?key=${encodeURIComponent(provider.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: 65536 } }), signal });
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || 'Gemini returned no text.';
    }
    if (provider.id === 'cohere') {
        const system = messages.find((m) => m.role === 'system')?.content;
        const userMessages = messages.filter((m) => m.role !== 'system');
        const res = await fetch(join(provider.baseUrl, '/v2/chat'), { method: 'POST', headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, preamble: system, messages: userMessages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })), temperature: 0.65, max_tokens: 2048 }), signal });
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return json.message?.content?.map((part) => part.text || '').join('') || 'Cohere returned no text.';
    }
    if (provider.id === 'anthropic') {
        const system = messages.find((m) => m.role === 'system')?.content;
        const res = await fetch(join(provider.baseUrl, '/v1/messages'), { method: 'POST', headers: { 'x-api-key': provider.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, system, max_tokens: 2048, messages: messages.filter((m) => m.role !== 'system') }), signal });
        if (!res.ok)
            throw new Error(await responseError(res));
        const json = await res.json();
        return json.content?.map((p) => p.text || '').join('') || 'Claude returned no text.';
    }
    const res = await fetch(join(provider.baseUrl, '/chat/completions'), { method: 'POST', headers: headers(provider), body: JSON.stringify({ model, messages, temperature: 0.65, max_tokens: 2048, stream: false }), signal });
    if (!res.ok)
        throw new Error(await responseError(res));
    const json = await res.json();
    return json.choices?.[0]?.message?.content || 'Provider returned no text.';
}
function safeMath(expression) {
    const normalized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    if (!normalized.trim())
        return null;
    try {
        return Function(`"use strict"; return (${normalized})`)();
    }
    catch {
        return null;
    }
}
export async function utilityAnswer(query) {
    const text = query.trim();
    const lower = text.toLowerCase();
    if (/^(what(?:'s| is) |tell me )?(the )?time(?: in | at )?/i.test(text)) {
        const cityMatch = text.match(/(?:time|clock)\s+(?:in|at)\s+([a-zA-Z ._-]+)/i);
        const tz = cityMatch ? encodeURIComponent(cityMatch[1].trim()) : 'Etc/UTC';
        try {
            const res = await fetch(`https://worldtimeapi.org/api/timezone/${tz}`);
            if (res.ok) {
                const json = await res.json();
                return { kind: 'utility', answer: `Local time in ${json.timezone || tz}: ${new Date(json.datetime || Date.now()).toLocaleString()}.` };
            }
        }
        catch { /* fall through to local clock */ }
        return { kind: 'utility', answer: `Current local time: ${new Date().toLocaleString()}.` };
    }
    if (/(weather|temperature|forecast)/i.test(text)) {
        const city = text.match(/(?:in|at|for)\s+([a-zA-Z ._-]+)/i)?.[1]?.trim() || 'Dhaka';
        try {
            const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { headers: { 'User-Agent': 'JARVIS/1.0' } });
            if (res.ok) {
                const json = await res.json();
                const c = json.current_condition?.[0];
                return { kind: 'utility', answer: `Weather for ${city}: ${c?.weatherDesc?.[0]?.value || 'available'}, ${c?.temp_C || '--'}°C, humidity ${c?.humidity || '--'}%.` };
            }
        }
        catch { /* fall through */ }
    }
    if (/^(calculate|compute|what is)\s+/i.test(text)) {
        const expression = text.replace(/^(calculate|compute|what is)\s+/i, '');
        const result = safeMath(expression);
        if (result !== null)
            return { kind: 'utility', answer: `${expression} = ${result}` };
    }
    if (/\b(search|look up|find online|browse the web)\b/i.test(lower)) {
        const q = text.replace(/\b(search|look up|find online|browse the web)\b/ig, '').trim();
        return await webSearchAnswer(q);
    }
    return null;
}
export async function failoverChat(providers, messages, preferred) {
    const ordered = [...providers].filter((p) => p.enabled && p.key).sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : a.priority - b.priority));
    const lastUserQuery = messages.filter((message) => message.role === 'user').at(-1)?.content || '';
    if (!ordered.length) {
        const web = await webSearchAnswer(lastUserQuery);
        if (web)
            return { answer: web.answer, provider: 'web', attempts: ['No configured AI keys; switched to sourced web search.'] };
        throw new Error('Configure at least one provider API key in SYSTEM > NEURAL LINK.');
    }
    const attempts = [];
    for (const provider of ordered) {
        try {
            const defaults = { openai: 'gpt-4o-mini', gemini: 'gemini-3.6-flash', anthropic: 'claude-3-5-haiku-latest', deepseek: 'deepseek-chat', xai: 'grok-3-mini', qwen: 'qwen-plus', kimi: 'moonshot-v1-8k', minimax: 'MiniMax-Text-01', perplexity: 'sonar', manus: 'manus', groq: 'openai/gpt-oss-120b', cohere: 'command-a-03-2025', huggingface: 'meta-llama/Llama-3.1-8B-Instruct' };
            const model = provider.model || defaults[provider.id];
            const answer = await chat(provider, messages, model);
            return { answer, provider: provider.id, attempts };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            attempts.push(`${provider.name}: ${message}`);
            const status = Number(message.match(/^\d+/)?.[0] || 500);
            const quotaMessage = /quota|rate.?limit|token|credit|capacity|context.?length|exhaust|insufficient/i.test(message);
            if (!isQuotaLike(status) && !quotaMessage)
                throw error;
        }
    }
    const web = await webSearchAnswer(lastUserQuery);
    if (web)
        return { answer: web.answer, provider: 'web', attempts: [...attempts, 'All configured AI links exhausted; switched to sourced web search.'] };
    throw new Error(`All configured neural links failed. ${attempts.join(' | ')}`);
}
