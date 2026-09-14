import type { ProviderDefinition } from "./types.js";

export const DEFAULT_PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-3.8-flash", priority: 1, enabledByDefault: true, protocol: "gemini" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", priority: 2, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-latest", priority: 3, enabledByDefault: true, protocol: "anthropic" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", priority: 4, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "xai", name: "xAI / Grok", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-3-mini", priority: 5, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", priority: 6, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.com", defaultModel: "command-a-03-2025", priority: 7, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", defaultModel: "sonar", priority: 8, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "qwen", name: "Qwen / DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", priority: 9, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "kimi", name: "Kimi / Moonshot", baseUrl: "https://api.moonshot.ai/v1", defaultModel: "moonshot-v1-8k", priority: 10, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", defaultModel: "MiniMax-Text-01", priority: 11, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "huggingface", name: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", defaultModel: "meta-llama/Llama-3.1-8B-Instruct", priority: 12, enabledByDefault: true, protocol: "openai-compatible" },
  { id: "manus", name: "Manus", baseUrl: "https://api.manus.ai/v1", defaultModel: "manus", priority: 13, enabledByDefault: false, protocol: "openai-compatible" },
];
