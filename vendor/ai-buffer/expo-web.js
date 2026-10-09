import { createPuterClient } from "./client.js";
/** Website builds use Puter. Phone builds report `"native"` from the same import. */
export const expoPlatform = "web";
export function createExpoClient(options = {}) {
    return createPuterClient({
        model: options.puterModel,
        defaultSystemPrompt: options.defaultSystemPrompt,
        loadPuter: options.loadPuter,
        timeoutMs: options.timeoutMs,
    });
}
