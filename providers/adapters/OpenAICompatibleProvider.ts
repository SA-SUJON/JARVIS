import type { Provider, ProviderRequest, ProviderResponse } from "../../core/contracts/types.js";
import type { ProviderCredentials, ProviderDefinition } from "../types.js";

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly name: string;

  private readonly baseUrl: string;
  private readonly keys: string[];
  private readonly defaultModel: string;
  private activeKeyIndex = 0;

  constructor(
    private readonly definition: ProviderDefinition,
    credentials: ProviderCredentials = {}
  ) {
    this.id = definition.id;
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
    if (!this.activeKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.activeKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    if (!this.activeKey) {
      throw new Error(`${this.name} is not configured`);
    }

    const started = Date.now();
    const payload = {
      model: request.model ?? this.defaultModel,
      messages: [
        ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
        ...(request.history ?? []),
        { role: "user", content: request.prompt },
      ],
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };

    let lastError = "Unknown provider error";

    for (let attempt = 0; attempt < Math.max(1, this.keys.length); attempt += 1) {
      const key = this.activeKey;
      if (!key) break;

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          lastError = `${response.status} ${response.statusText}`;
          if ([401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
            if (this.rotateKey()) continue;
          }
          throw new Error(`${this.name}: ${lastError}`);
        }

        const json = await response.json() as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const content = json.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error(`${this.name}: provider returned an empty response`);

        return {
          requestId: request.requestId,
          providerId: this.id,
          model: json.model ?? payload.model,
          content,
          latencyMs: Date.now() - started,
          finishReason: json.choices?.[0]?.finish_reason,
          usage: json.usage
            ? {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt + 1 < this.keys.length && this.rotateKey()) continue;
        throw error instanceof Error ? error : new Error(lastError);
      }
    }

    throw new Error(`${this.name}: ${lastError}`);
  }

  async listModels(): Promise<string[]> {
    if (!this.activeKey) return [this.defaultModel];
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.activeKey}` },
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
