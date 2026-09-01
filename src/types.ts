export type ProviderId = 'openai' | 'gemini' | 'anthropic' | 'deepseek' | 'xai' | 'qwen' | 'kimi' | 'minimax' | 'perplexity' | 'manus' | 'groq' | 'cohere' | 'huggingface';
export type ProviderConfig = { id: ProviderId; name: string; baseUrl: string; key?: string; model?: string; enabled: boolean; priority: number; status?: 'online' | 'offline' | 'quota' | 'unconfigured' | 'error'; lastError?: string };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; provider?: string; timestamp?: string; images?: string[] };
export type ModelInfo = { id: string; label: string; provider: ProviderId; context?: number; capabilities?: string[]; created?: number | string };
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
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
export type VoiceProfile = 'natural' | 'classic' | 'deep';
export type EdgeVoice = { id: string; name: string; gender: string; locale: string; personalities: readonly string[]; categories: readonly string[] };
export type JarvisSettings = { providers: ProviderConfig[]; voice: string; voiceProfile: VoiceProfile; language: string; wakeWord: boolean; voiceEnabled: boolean; assistantName: string; userName: string; legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } };
export const VOICE_PROFILES: Array<{ id: VoiceProfile; label: string; detail: string }> = [
  { id: 'natural', label: 'NATURAL', detail: 'Balanced conversational delivery' },
  { id: 'classic', label: 'CLASSIC JARVIS', detail: 'Measured British-butler cadence' },
  { id: 'deep', label: 'DEEP COMMAND', detail: 'Lower, slower, deliberate delivery' }
];
export const VOICES = [
  { id: 'en-CA-LiamNeural', label: 'Liam Neural', detail: 'Imported default from jarvisai .env' },
  { id: 'en-GB-RyanNeural', label: 'Ryan Neural', detail: 'Calm, measured British' },
  { id: 'en-GB-ThomasNeural', label: 'Thomas Neural', detail: 'Warm British alternative' },
  { id: 'en-US-GuyNeural', label: 'Guy Neural', detail: 'Deep American inflection' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher Neural', detail: 'Deep American alternate' }
];
