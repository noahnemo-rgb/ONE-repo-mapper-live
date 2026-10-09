import { createGeminiClient, createLlmapiClient, createNvidiaClient, createOpenRouterClient, createPuterClient, createSpaceBunnyClient, createVercelGatewayClient, } from "./client.js";
import { AiBufferError, asAiError } from "./errors.js";
const FAILOVER_CODES = new Set(["missing_key", "signed_out", "rate_limited", "payment_required", "provider_error"]);
/**
 * Used when a call does not name a route.
 * Space Bunny Alpha, then OpenRouter, then Puter, then the other configured routes.
 * A route that was not passed in is skipped.
 */
export const DEFAULT_CALL_ORDER = [
    "space-bunny",
    "openrouter",
    "puter",
    "vercel-gateway",
    "gemini",
    "nvidia",
    "llmapi",
];
function canFailover(error) {
    return error instanceof AiBufferError && FAILOVER_CODES.has(error.code);
}
export function createCallRouter(options = {}) {
    const clients = {};
    if (options.puter)
        clients.puter = createPuterClient(options.puter);
    if (options.openrouter)
        clients.openrouter = createOpenRouterClient(options.openrouter);
    if (options.spaceBunny)
        clients["space-bunny"] = createSpaceBunnyClient(options.spaceBunny);
    if (options.vercelGateway)
        clients["vercel-gateway"] = createVercelGatewayClient(options.vercelGateway);
    if (options.gemini)
        clients.gemini = createGeminiClient(options.gemini);
    if (options.nvidia)
        clients.nvidia = createNvidiaClient(options.nvidia);
    if (options.llmapi)
        clients.llmapi = createLlmapiClient(options.llmapi);
    const defaultOrder = (options.order ?? DEFAULT_CALL_ORDER).filter((id) => clients[id]);
    return {
        route(id) {
            const client = clients[id];
            if (!client) {
                throw new AiBufferError("provider_error", `The ${id} route is not configured on this router.`);
            }
            return client;
        },
        async getInfo() {
            const info = {};
            for (const id of Object.keys(clients)) {
                info[id] = await clients[id].getInfo();
            }
            return info;
        },
        async streamChat(params) {
            const { route, order, ...chat } = params;
            const plan = route ? [route] : order ?? defaultOrder;
            if (plan.length === 0) {
                throw new AiBufferError("provider_error", "No call route is configured.");
            }
            let last;
            for (let index = 0; index < plan.length; index += 1) {
                const id = plan[index];
                const client = clients[id];
                if (!client) {
                    if (route) {
                        throw new AiBufferError("provider_error", `The ${id} route is not configured on this router.`);
                    }
                    continue;
                }
                try {
                    return await client.streamChat(chat);
                }
                catch (error) {
                    const wrapped = asAiError(error);
                    const more = index < plan.length - 1 && plan.slice(index + 1).some((next) => clients[next]);
                    if (!canFailover(wrapped) || !more)
                        throw wrapped;
                    last = wrapped;
                }
            }
            throw asAiError(last ?? new AiBufferError("provider_error", "No call route is configured."));
        },
    };
}
