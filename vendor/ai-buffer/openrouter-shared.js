export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export function openRouterRequestBody(options) {
    return JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        ...options.extra,
    });
}
