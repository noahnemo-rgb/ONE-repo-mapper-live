import { createOpenRouterClient } from "./client.js";
/** Phone builds use OpenRouter. Website builds report `"web"` from the same import. */
export const expoPlatform = "native";
export function createExpoClient(options = {}) {
    return createOpenRouterClient({
        getApiKey: options.getApiKey ?? (async () => null),
        getModel: options.getOpenRouterModel,
        model: options.openrouterModel,
        defaultSystemPrompt: options.defaultSystemPrompt,
        siteUrl: options.siteUrl,
        appName: options.appName,
        transport: "xhr",
        timeoutMs: options.timeoutMs,
    });
}
