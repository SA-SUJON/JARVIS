import { RuntimeKernel } from "../core/runtime/RuntimeKernel.js";
import { DEFAULT_PROVIDER_DEFINITIONS } from "../providers/definitions.js";
import type { ProviderManagerOptions, ProviderId } from "../providers/types.js";
import type { ProviderConfig } from "./providers.js";

export interface Mark05RuntimeSettings {
  providers: ProviderConfig[];
}

/**
 * Converts the legacy Electron provider settings into MARK_05 runtime
 * credentials. Secrets remain in memory only; this module never persists them.
 */
export function createMark05Runtime(settings: Mark05RuntimeSettings): RuntimeKernel {
  const configured = new Map(settings.providers.map((provider) => [provider.id, provider]));

  const definitions = DEFAULT_PROVIDER_DEFINITIONS.map((definition) => {
    const provider = configured.get(definition.id);
    return {
      ...definition,
      baseUrl: provider?.baseUrl || definition.baseUrl,
      defaultModel: provider?.model || definition.defaultModel,
      priority: provider?.priority ?? definition.priority,
      enabledByDefault: provider?.enabled ?? definition.enabledByDefault,
    };
  });

  const credentials: ProviderManagerOptions["credentials"] = {};
  for (const definition of definitions) {
    const provider = configured.get(definition.id);
    if (!provider) continue;

    const keys = Array.from(
      new Set(
        [
          ...(provider.keys || []),
          ...(provider.key ? provider.key.split(/[,;\r\n]+/) : []),
        ]
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    );

    if (keys.length) {
      credentials[definition.id as ProviderId] = {
        apiKey: keys[0],
        apiKeys: keys,
      };
    }
  }

  return new RuntimeKernel({
    providers: {
      definitions,
      credentials,
    },
  });
}
