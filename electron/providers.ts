export type ProviderId = 'openai' | 'gemini' | 'anthropic' | 'deepseek' | 'xai' | 'qwen' | 'kimi' | 'minimax' | 'perplexity' | 'manus' | 'groq' | 'cohere' | 'huggingface';

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  key?: string;
  keys?: string[]; // Multiple keys pool (especially for Gemini)
  model?: string;
  enabled: boolean;
  priority: number;
  status?: 'online' | 'offline' | 'quota' | 'unconfigured' | 'error';
  lastError?: string;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelInfo = { id: string; label: string; name?: string; provider: ProviderId; tier?: 'free' | 'paid'; context?: number; capabilities?: string[]; created?: number | string };
import { loadAndVerifyIdentity, detectIdentityIntent, getHardenedIdentityAnswer, sanitizeAIResponse } from './identity.js';

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'gemini', name: 'Google Gemini (Primary AI)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', enabled: true, priority: 1 },
  { id: 'openai', name: 'ChatGPT / OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', enabled: true, priority: 2 },
  { id: 'anthropic', name: 'Claude / Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest', enabled: true, priority: 3 },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', enabled: true, priority: 4 },
  { id: 'xai', name: 'Grok / xAI', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini', enabled: true, priority: 5 },
  { id: 'groq', name: 'Groq / Llama Fast Cloud', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', enabled: true, priority: 6 },
  { id: 'cohere', name: 'Cohere / Query Selector', baseUrl: 'https://api.cohere.com', model: 'command-a-03-2025', enabled: true, priority: 7 },
  { id: 'perplexity', name: 'Perplexity Search', baseUrl: 'https://api.perplexity.ai', model: 'sonar', enabled: true, priority: 8 },
  { id: 'qwen', name: 'Qwen / DashScope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', enabled: true, priority: 9 },
  { id: 'kimi', name: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.ai/v1', model: 'moonshot-v1-8k', enabled: true, priority: 10 },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-Text-01', enabled: true, priority: 11 },
  { id: 'huggingface', name: 'Hugging Face / Diffusion Image', baseUrl: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.1-8B-Instruct', enabled: true, priority: 12 },
  { id: 'manus', name: 'Manus / Custom', baseUrl: 'https://api.manus.ai/v1', model: 'manus', enabled: false, priority: 13 }
];

export const CURATED_MODELS: Record<string, Array<{ id: string; label: string; tier: 'free' | 'paid' }>> = {
  gemini: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Latest // Fast)', tier: 'free' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (High Speed)', tier: 'free' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Multimodal)', tier: 'free' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Standard)', tier: 'free' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash (Free Tier)', tier: 'free' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Deep Reasoning // Paid)', tier: 'paid' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast // Cost-Effective)', tier: 'free' },
    { id: 'gpt-4o', label: 'GPT-4o (Flagship Multimodal // Paid)', tier: 'paid' },
    { id: 'o3-mini', label: 'o3-mini (High Speed Reasoning)', tier: 'paid' },
  ],
  anthropic: [
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (Fastest)', tier: 'free' },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet (Hybrid Reasoning // Paid)', tier: 'paid' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Coding Flagship // Paid)', tier: 'paid' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3 (Chat // Ultra-Low Cost)', tier: 'free' },
    { id: 'deepseek-reasoner', label: 'DeepSeek R1 (Deep Reasoning)', tier: 'free' },
  ],
  xai: [
    { id: 'grok-3-mini', label: 'Grok 3 Mini (High Throughput)', tier: 'free' },
    { id: 'grok-3', label: 'Grok 3 (Full Reasoning // Paid)', tier: 'paid' },
    { id: 'grok-2', label: 'Grok 2 (Multimodal)', tier: 'paid' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (Free Cloud)', tier: 'free' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Ultra-Low Latency)', tier: 'free' },
  ],
  cohere: [
    { id: 'command-a-03-2025', label: 'Command A (Query Selector // Fast)', tier: 'free' },
    { id: 'command-r-plus', label: 'Command R+ (Complex Multi-Step)', tier: 'paid' },
    { id: 'command-r', label: 'Command R (Conversational)', tier: 'free' },
  ],
};

const isQuotaLike = (status: number) => [401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
const join = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;

type WebHit = { title: string; url: string; snippet: string };
const htmlText = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export async function webSearchAnswer(query: string): Promise<{ kind: 'search'; answer: string } | null> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;
  try {
    const instant = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=0`, { headers: { 'User-Agent': 'JARVIS/1.0 web-search' } });
    const instantJson = instant.ok ? await instant.json() as { AbstractText?: string; AbstractURL?: string; Heading?: string } : {};
    const html = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, { headers: { 'User-Agent': 'Mozilla/5.0 JARVIS/1.0' } }).then((response) => response.ok ? response.text() : '');
    const hits: WebHit[] = [];
    const resultPattern = /class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = resultPattern.exec(html)) && hits.length < 6) {
      const rawUrl = htmlText(match[1]); let url = rawUrl;
      try { const parsed = new URL(rawUrl, 'https://html.duckduckgo.com'); url = parsed.searchParams.get('uddg') || rawUrl; } catch { /* keep raw URL */ }
      if (!/^https?:\/\//i.test(url)) continue;
      const title = htmlText(match[2]); const start = match.index; const body = html.slice(start, start + 1800); const snippetMatch = body.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i); const snippet = htmlText(snippetMatch?.[1] || '');
      if (title && !hits.some((hit) => hit.url === url)) hits.push({ title, url, snippet });
    }
    const lines: string[] = [`According to live DuckDuckGo results for “${cleanQuery}”: `];
    if (instantJson.AbstractText) lines.push(`${instantJson.Heading ? `${instantJson.Heading}: ` : ''}${instantJson.AbstractText}`);
    hits.slice(0, 4).forEach((hit) => lines.push(`\n• ${hit.title}: ${hit.snippet || ''} (Source: ${hit.url})`));
    if (lines.length === 1) return { kind: 'search', answer: `I searched DuckDuckGo for “${cleanQuery}”, but no live indexed entries were returned. Please try rephrasing.` };
    return { kind: 'search', answer: lines.join('\n') };
  } catch (error) {
    return { kind: 'search', answer: `Internet lookup is currently unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function headers(provider: ProviderConfig) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key ?? ''}` };
}

async function responseError(res: Response) {
  const text = await res.text().catch(() => '');
  return `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 180)}` : ''}`;
}

export function extractProviderKeys(provider: ProviderConfig): string[] {
  const keys: string[] = [];
  if (Array.isArray(provider.keys)) {
    provider.keys.forEach((k) => {
      const clean = String(k || '').trim();
      if (clean && !keys.includes(clean)) keys.push(clean);
    });
  }
  if (provider.key) {
    const parts = provider.key.split(/[,;\r\n]+/);
    parts.forEach((p) => {
      const clean = p.trim();
      if (clean && !keys.includes(clean)) keys.push(clean);
    });
  }
  return keys;
}

export async function listModels(provider: ProviderConfig): Promise<ModelInfo[]> {
  const curated = CURATED_MODELS[provider.id] || [];
  const baseModels: ModelInfo[] = curated.map((m) => ({
    id: m.id,
    label: m.label,
    provider: provider.id,
    tier: m.tier,
  }));

  const allKeys = extractProviderKeys(provider);
  const activeKey = allKeys[0] || provider.key;
  if (!activeKey) return baseModels;

  try {
    if (provider.id === 'gemini') {
      const res = await fetch(`${join(provider.baseUrl, '/models')}?key=${encodeURIComponent(activeKey)}`);
      if (res.ok) {
        const json = await res.json() as { models?: Array<{ name: string; displayName?: string; baseModelId?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
        const fetched = (json.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m) => {
            const cleanId = m.baseModelId || m.name.replace(/^models\//, '');
            const isPaid = /pro|ultra|exp/i.test(cleanId);
            return {
              id: cleanId,
              label: `${m.displayName || cleanId} (${isPaid ? 'Paid' : 'Free'})`,
              provider: provider.id,
              tier: isPaid ? 'paid' : 'free' as 'free' | 'paid',
              context: m.inputTokenLimit,
              capabilities: m.supportedGenerationMethods,
            };
          });
        // Merge fetched on top of curated
        const map = new Map<string, ModelInfo>();
        baseModels.forEach((m) => map.set(m.id, m));
        fetched.forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      }
    }
    if (provider.id === 'openai') {
      const res = await fetch(join(provider.baseUrl, '/models'), { headers: { Authorization: `Bearer ${activeKey}` } });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string }> };
        const fetched = (json.data ?? [])
          .filter((m) => /gpt|o1|o3|chat/i.test(m.id))
          .map((m) => ({
            id: m.id,
            label: `${m.id} (${/mini/i.test(m.id) ? 'Low Cost' : 'Paid'})`,
            provider: provider.id,
            tier: /mini/i.test(m.id) ? 'free' : 'paid' as 'free' | 'paid',
          }));
        const map = new Map<string, ModelInfo>();
        baseModels.forEach((m) => map.set(m.id, m));
        fetched.forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      }
    }
    if (provider.id === 'anthropic') {
      const res = await fetch(join(provider.baseUrl, '/v1/models?limit=100'), { headers: { 'x-api-key': activeKey, 'anthropic-version': '2023-06-01' } });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string; display_name?: string }> };
        const fetched = (json.data ?? []).map((m) => ({
          id: m.id,
          label: `${m.display_name || m.id} (${/haiku/i.test(m.id) ? 'Fast' : 'Paid'})`,
          provider: provider.id,
          tier: /haiku/i.test(m.id) ? 'free' : 'paid' as 'free' | 'paid',
        }));
        const map = new Map<string, ModelInfo>();
        baseModels.forEach((m) => map.set(m.id, m));
        fetched.forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      }
    }
  } catch {
    /* Network or key error during listModels: graceful return of curated models */
  }

  return baseModels;
}

export async function chat(provider: ProviderConfig, messages: ChatMessage[], model: string, signal?: AbortSignal): Promise<string> {
  const keys = extractProviderKeys(provider);
  if (!keys.length) throw new Error(`${provider.name} API key not configured.`);

  if (provider.id === 'gemini') {
    const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const system = messages.find((m) => m.role === 'system')?.content;

    // Multi-key sequential attempt
    let lastError = '';
    for (let i = 0; i < keys.length; i++) {
      const currentKey = keys[i];
      try {
        const res = await fetch(`${join(provider.baseUrl, `/models/${model}:generateContent`)}?key=${encodeURIComponent(currentKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: 65536, temperature: 0.7 } }),
          signal,
        });

        if (res.ok) {
          const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const answer = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
          if (answer) return answer;
        }

        const errText = await res.text().catch(() => '');
        lastError = `${res.status} ${errText.slice(0, 160)}`;
        if (res.status === 429 || res.status === 403 || /quota|exhaust/i.test(errText)) {
          // Rotate to next Gemini key
          continue;
        }
      } catch (keyErr) {
        lastError = String(keyErr);
      }
    }

    throw new Error(`Gemini keys exhausted (${lastError || 'Quota limit reached'})`);
  }

  const activeKey = keys[0];
  if (provider.id === 'cohere') {
    const system = messages.find((m) => m.role === 'system')?.content;
    const userMessages = messages.filter((m) => m.role !== 'system');
    const res = await fetch(join(provider.baseUrl, '/v2/chat'), { method: 'POST', headers: { Authorization: `Bearer ${activeKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, preamble: system, messages: userMessages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })), temperature: 0.7, max_tokens: 2048 }), signal });
    if (!res.ok) throw new Error(await responseError(res));
    const json = await res.json() as { message?: { content?: Array<{ text?: string }> } };
    return json.message?.content?.map((part) => part.text || '').join('') || 'Cohere returned no text.';
  }

  if (provider.id === 'anthropic') {
    const system = messages.find((m) => m.role === 'system')?.content;
    const res = await fetch(join(provider.baseUrl, '/v1/messages'), { method: 'POST', headers: { 'x-api-key': activeKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, system, max_tokens: 2048, messages: messages.filter((m) => m.role !== 'system') }), signal });
    if (!res.ok) throw new Error(await responseError(res));
    const json = await res.json() as { content?: Array<{ text?: string }> };
    return json.content?.map((p) => p.text || '').join('') || 'Claude returned no text.';
  }

  const res = await fetch(join(provider.baseUrl, '/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeKey}` }, body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048, stream: false }), signal });
  if (!res.ok) throw new Error(await responseError(res));
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content || 'Provider returned no text.';
}

function safeMath(expression: string) {
  const normalized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
  if (!normalized.trim()) return null;
  try { return Function(`"use strict"; return (${normalized})`)(); } catch { return null; }
}

export async function utilityAnswer(query: string, identity?: { userName?: string; assistantName?: string }): Promise<{ kind: 'utility' | 'search'; answer: string } | null> {
  const text = query.trim();
  const lower = text.toLowerCase();

  // Natural greeting handling
  if (/^(hi|hello|hey|hey there|greetings|good\s+(morning|afternoon|evening|day))(\s+jarvis|\s+there|\s+buddy)?[\s.!?,]*$/i.test(text)) {
    const user = identity?.userName || 'Sir';
    const assistant = identity?.assistantName || 'JARVIS';
    return { kind: 'utility', answer: `Hello, ${user}. ${assistant} is online and all local subsystems are operational. How may I assist you today?` };
  }

  // Cryptographically verified Assistant & Creator Identity
  const identityIntent = detectIdentityIntent(text);
  if (identityIntent) {
    const verified = loadAndVerifyIdentity();
    return {
      kind: 'utility',
      answer: getHardenedIdentityAnswer(identityIntent, verified),
    };
  }

  // General assistant status
  if (/^(what can you do|system status|are you there|status)[\s.?]*$/i.test(text)) {
    const assistant = identity?.assistantName || 'JARVIS';
    return {
      kind: 'utility',
      answer: `I am ${assistant}, your personal desktop command center and AI assistant. I monitor host telemetry, perform calculations, check the weather and time, control system apps, and connect to neural AI models.`,
    };
  }

  if (/^(what(?:'s| is) |tell me )?(the )?time(?: in | at )?/i.test(text)) {
    const cityMatch = text.match(/(?:time|clock)\s+(?:in|at)\s+([a-zA-Z ._-]+)/i);
    const tz = cityMatch ? encodeURIComponent(cityMatch[1].trim()) : 'Etc/UTC';
    try {
      const res = await fetch(`https://worldtimeapi.org/api/timezone/${tz}`);
      if (res.ok) { const json = await res.json() as { datetime?: string; timezone?: string }; return { kind: 'utility', answer: `The current time in ${json.timezone || tz} is ${new Date(json.datetime || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` }; }
    } catch { /* fall through to local clock */ }
    return { kind: 'utility', answer: `It is currently ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` };
  }
  if (/(weather|temperature|forecast)/i.test(text)) {
    const city = text.match(/(?:in|at|for)\s+([a-zA-Z ._-]+)/i)?.[1]?.trim() || 'Dhaka';
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { headers: { 'User-Agent': 'JARVIS/1.0' } });
      if (res.ok) {
        const json = await res.json() as { current_condition?: Array<{ temp_C?: string; weatherDesc?: Array<{ value?: string }>; humidity?: string }> };
        const c = json.current_condition?.[0];
        return { kind: 'utility', answer: `The weather in ${city} is currently ${c?.weatherDesc?.[0]?.value || 'clear'}, with a temperature of ${c?.temp_C || '--'}°C and ${c?.humidity || '--'}% humidity.` };
      }
    } catch { /* fall through */ }
  }
  if (/^(calculate|compute|what is)\s+/i.test(text)) {
    const expression = text.replace(/^(calculate|compute|what is)\s+/i, '');
    const result = safeMath(expression);
    if (result !== null) return { kind: 'utility', answer: `${expression} equals ${result}.` };
  }
  return null;
}

export async function failoverChat(providers: ProviderConfig[], messages: ChatMessage[], preferred?: ProviderId): Promise<{ answer: string; provider: ProviderId | 'web'; attempts: string[] }> {
  // Sort providers with preferred first, then priority order
  const ordered = [...providers]
    .filter((p) => p.enabled && (p.key || (p.keys && p.keys.length > 0)))
    .sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : a.priority - b.priority));

  const lastUserQuery = messages.filter((message) => message.role === 'user').at(-1)?.content || '';
  if (!ordered.length) {
    const web = await webSearchAnswer(lastUserQuery);
    if (web) return { answer: web.answer, provider: 'web', attempts: ['No configured AI keys; switched to DuckDuckGo web lookup.'] };
    return {
      answer: `All local JARVIS offline systems are operational. To enable generative AI conversation and deep reasoning, please open Settings (gear icon in the top right) and configure an active API key (such as Google Gemini, Groq, or OpenAI).`,
      provider: 'web',
      attempts: ['No configured AI keys and no indexed web results.'],
    };
  }

  const attempts: string[] = [];
  const defaults: Record<ProviderId, string> = {
    gemini: 'gemini-3.8-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    deepseek: 'deepseek-chat',
    xai: 'grok-3-mini',
    groq: 'llama-3.3-70b-versatile',
    cohere: 'command-a-03-2025',
    perplexity: 'sonar',
    qwen: 'qwen-plus',
    kimi: 'moonshot-v1-8k',
    minimax: 'MiniMax-Text-01',
    huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
    manus: 'manus',
  };

  for (const provider of ordered) {
    try {
      const model = provider.model || defaults[provider.id];
      const answer = await chat(provider, messages, model);
      const verified = loadAndVerifyIdentity();
      return { answer: sanitizeAIResponse(answer, verified), provider: provider.id, attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${provider.name}: ${message}`);
      // Silent seamless rollover to next provider on ANY failure
      continue;
    }
  }

  // If all providers failed, fall back to DuckDuckGo web search
  const web = await webSearchAnswer(lastUserQuery);
  if (web) return { answer: web.answer, provider: 'web', attempts: [...attempts, 'Switched to DuckDuckGo web search.'] };

  return {
    answer: `All neural links were temporarily unavailable. Details: ${attempts.join('; ')}`,
    provider: 'web',
    attempts,
  };
}
