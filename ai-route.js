// Pinned to ai-buffer d0c7cbc40df991805efaf64223a00fc3fbb72e15 (Space Bunny Alpha).
import { createCallRouter } from "./vendor/ai-buffer/index.js";

const SITE = "https://repo-mapper-live-8trm.vercel.app";

export function repoNotes(current) {
  const repo = current?.repo || {};
  const files = (current?.critical || [])
    .slice(0, 4)
    .map((file) => `${file.path}\n${String(file.snippet || "").slice(0, 500)}`)
    .join("\n\n");
  return [
    `Repo: ${repo.fullName || "unknown"}`,
    `Description: ${repo.description || ""}`,
    `Language: ${repo.language || ""}`,
    "",
    "Key files:",
    files,
  ].join("\n");
}

/**
 * Puter first in the browser. A saved key tries Space Bunny Alpha, then gpt-4o-mini.
 */
export function createMapperRouter({ apiKey, fetchImpl, loadPuter, timeoutMs }) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const shared = key
    ? {
        getApiKey: () => key,
        appName: "Repo Mapper",
        siteUrl: SITE,
        fetchImpl,
        timeoutMs,
      }
    : null;
  return createCallRouter({
    puter: { model: "openai/gpt-4o-mini", loadPuter, timeoutMs },
    ...(shared
      ? {
          spaceBunny: shared,
          openrouter: { ...shared, model: "openai/gpt-4o-mini" },
        }
      : {}),
    order: ["puter", "space-bunny", "openrouter"],
  });
}

export async function askMapper({ apiKey, current, question, fetchImpl, loadPuter }) {
  const router = createMapperRouter({ apiKey, fetchImpl, loadPuter, timeoutMs: 55000 });
  return router.streamChat({
    message: question,
    systemPrompt:
      "You explain a GitHub repo to the person mapping it. Be concrete and short. Stay with the notes you were given.",
    context: repoNotes(current),
  });
}
