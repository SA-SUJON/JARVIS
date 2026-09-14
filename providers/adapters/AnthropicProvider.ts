import type { Provider, ProviderRequest, ProviderResponse } from "../../core/contracts/types.js";
import type { ProviderCredentials, ProviderDefinition } from "../types.js";

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
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
    if (!this.activeKey) throw new Error("Anthropic is not configured");

    const started = Date.now();
    const model = request.model ?? this.defaultModel;
    const messages = [
      ...(request.history ?? [])
        .filter((item) => item.role !== "system")
        .map((item) => ({ role: item.role, content: item.content })),
      { role: "user" as const, content: request.prompt },
    ];

    for (let attempt = 0; attempt < Math.max(1, this.keys.length); attempt += 1) {
      const key = this.activeKey;
      if (!key) break;

      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? 2048,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          messages,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = `Anthropic: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 160)}` : ""}`;
        if ([401, 403, 408, 409, 429, 500, 502, 503, 504].includes(response.status) && this.rotateKey()) continue;
        throw new Error(message);
      }

      const json = await response.json() as {
        model?: string;
        content?: Array<{ type?: string; text?: string }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const content = (json.content ?? [])
        .filter((item) => item.type === "text" || item.type === undefined)
        .map((item) => item.text ?? "")
        .join("")
        .trim();

      if (!content) throw new Error("Anthropic returned an empty response");

      return {
        requestId: request.requestId,
        providerId: this.id,
        model: json.model ?? model,
        content,
        latencyMs: Date.now() - started,
        finishReason: json.stop_reason,
        usage: json.usage
          ? {
              inputTokens: json.usage.input_tokens,
              outputTokens: json.usage.output_tokens,
              totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
            }
          : undefined,
      };
    }

    throw new Error("Anthropic: all configured keys failed");
  }

  async listModels(): Promise<string[]> {
    if (!this.activeKey) return [this.defaultModel];
    try {
      const response = await fetch(`${this.baseUrl}/v1/models?limit=100`, {
        headers: {
          "x-api-key": this.activeKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!response.ok) return [this.defaultModel];
      const json = await response.json() as { data?: Array<{ id?: string }> };
      const models = (json.data ?? []).map((model) => model.id).filter(Boolean) as string[];
      return models.length ? [...new Set(models)] : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }
}
