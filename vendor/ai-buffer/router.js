import { createOpenRouterClient, createPuterClient, createSpaceBunnyClient } from "./client.js";
import { AiBufferError, asAiError } from "./errors.js";
const FAILOVER_CODES = new Set(["missing_key", "signed_out", "rate_limited", "payment_required", "provider_error"]);
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
    const defaultOrder = (options.order ?? ["space-bunny", "openrouter", "puter"]).filter((id) => clients[id]);
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
