import type { Provider, ProviderRequest, ProviderResponse } from "../../core/contracts/types.js";
import type { ProviderCredentials, ProviderDefinition } from "../types.js";

export class GeminiProvider implements Provider {
  readonly id = "gemini";
  readonly name: string;

  private readonly baseUrl: string;
  private readonly keys: string[];
  private readonly defaultModel: string;
  private activeKeyIndex = 0;

  constructor(
    definition: ProviderDefinition,
    credentials: ProviderCredentials = {}
  ) {
    this.name = definition.name;
    this.baseUrl = definition.baseUrl.replace(/\/$/, "");
    this.defaultModel = definition.defaultModel;
    this.keys = [...new Set([...(credentials.apiKeys ?? []), credentials.apiKey].filter(Boolean))] as string[];
  }

  private get activeKey(): string | undefined {
    return this.keys[this.activeKeyIndex];
  }

  private rotateKey(): boolean {
    if (this.keys.length < 2) return false;
    this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.activeKey);
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    if (!this.activeKey) throw new Error("Google Gemini is not configured");

    const started = Date.now();
    const model = request.model ?? this.defaultModel;
    const contents = [
      ...(request.history ?? []).filter((item) => item.role !== "system").map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: request.prompt }] },
    ];

    const generationConfig = {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
    };

    for (let attempt = 0; attempt < Math.max(1, this.keys.length); attempt += 1) {
      const key = this.activeKey;
      if (!key) break;

      const response = await fetch(
        `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
            contents,
            generationConfig,
          }),
        }
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = `Gemini: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 160)}` : ""}`;
        if ([401, 403, 408, 429, 500, 502, 503, 504].includes(response.status) && this.rotateKey()) continue;
        throw new Error(message);
      }

      const json = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };

      const content = (json.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!content) throw new Error("Gemini returned an empty response");

      return {
        requestId: request.requestId,
        providerId: this.id,
        model,
        content,
        latencyMs: Date.now() - started,
        finishReason: json.candidates?.[0]?.finishReason,
        usage: json.usageMetadata
          ? {
              inputTokens: json.usageMetadata.promptTokenCount,
              outputTokens: json.usageMetadata.candidatesTokenCount,
              totalTokens: json.usageMetadata.totalTokenCount,
            }
          : undefined,
      };
    }

    throw new Error("Gemini: all configured keys failed");
  }

  async listModels(): Promise<string[]> {
    if (!this.activeKey) return [this.defaultModel];
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(this.activeKey)}`);
      if (!response.ok) return [this.defaultModel];
      const json = await response.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      const models = (json.models ?? [])
        .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((model) => model.name?.replace(/^models\//, ""))
        .filter(Boolean) as string[];
      return models.length ? [...new Set(models)] : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }
}
