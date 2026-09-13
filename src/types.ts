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

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  provider?: string;
  timestamp?: string;
  images?: string[];
};

export type ModelInfo = {
  id: string;
  label: string;
  name?: string;
  provider: ProviderId;
  tier?: 'free' | 'paid';
  context?: number;
  capabilities?: string[];
  created?: number | string;
};

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

export type VoiceProfile = 'natural' | 'classic' | 'deep';
export type EdgeVoice = { id: string; name: string; gender: string; locale: string; personalities: readonly string[]; categories: readonly string[] };
export type JarvisSettings = {
  providers: ProviderConfig[];
  voice: string;
  voiceProfile: VoiceProfile;
  language: string;
  wakeWord: boolean;
  voiceEnabled: boolean;
  assistantName: string;
  userName: string;
  legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string };
  geminiKeys?: string[];
};

export const VOICE_PROFILES: Array<{ id: VoiceProfile; label: string; detail: string }> = [
  { id: 'natural', label: 'NATURAL HUMAN', detail: 'Warm conversational human delivery' },
  { id: 'classic', label: 'CLASSIC JARVIS', detail: 'Measured British-butler cadence' },
  { id: 'deep', label: 'DEEP COMMAND', detail: 'Lower, slower, deliberate delivery' }
];

export const VOICES = [
  { id: 'en-CA-LiamNeural', label: 'Liam Neural', detail: 'Warm natural human tone' },
  { id: 'en-GB-RyanNeural', label: 'Ryan Neural', detail: 'Calm, measured British' },
  { id: 'en-GB-ThomasNeural', label: 'Thomas Neural', detail: 'Warm British alternative' },
  { id: 'en-US-GuyNeural', label: 'Guy Neural', detail: 'Deep American inflection' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher Neural', detail: 'Deliberate command delivery' }
];
