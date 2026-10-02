import { anySignal } from "./abort.js";
import { AiBufferError } from "./errors.js";
/**
 * Remembers the conversation for one screen.
 * A second send while a reply is streaming is rejected. Stop or wait, then send again.
 * A failed or cancelled send leaves the history as it was.
 */
export function createChatSession(client, options = {}) {
    const turns = [...(options.history ?? [])];
    let busy = false;
    let generation = 0;
    let currentAbort;
    return {
        get history() {
            return turns;
        },
        get busy() {
            return busy;
        },
        stop() {
            currentAbort?.abort();
        },
        reset() {
            generation += 1;
            currentAbort?.abort();
            turns.length = 0;
        },
        async send(message, sendOptions = {}) {
            if (busy) {
                throw new AiBufferError("busy", "A reply is already in progress.");
            }
            const gen = generation;
            const controller = new AbortController();
            currentAbort = controller;
            busy = true;
            try {
                const signal = sendOptions.signal ? anySignal([sendOptions.signal, controller.signal]) : controller.signal;
                const reply = await client.streamChat({
                    message,
                    history: turns.slice(),
                    systemPrompt: options.systemPrompt,
                    context: sendOptions.context,
                    onChunk: sendOptions.onChunk,
                    signal,
                    timeoutMs: sendOptions.timeoutMs,
                });
                if (gen === generation) {
                    turns.push({ role: "user", content: message });
                    turns.push({ role: "assistant", content: reply });
                }
                return reply;
            }
            finally {
                if (currentAbort === controller)
                    currentAbort = undefined;
                busy = false;
            }
        },
    };
}
