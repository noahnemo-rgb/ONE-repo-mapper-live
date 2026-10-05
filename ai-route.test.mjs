import assert from "node:assert/strict";
import test from "node:test";
import { askMapper, repoNotes } from "./ai-route.js";

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("notes name the repo and a key file", () => {
  const notes = repoNotes({
    repo: { fullName: "noahnemo-rgb/ONE-repo-mapper-live", description: "Map", language: "JavaScript" },
    critical: [{ path: "app-static.js", snippet: "const GH_API" }],
  });
  assert.match(notes, /ONE-repo-mapper-live/);
  assert.match(notes, /app-static\.js/);
});

test("a saved key tries Space Bunny Alpha, then gpt-4o-mini", async () => {
  const models = [];
  const text = await askMapper({
    apiKey: "sk-test",
    question: "What is the entry file?",
    current: { repo: { fullName: "owner/repo" }, critical: [] },
    loadPuter: async () => {
      throw new Error("puter unavailable");
    },
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      models.push(payload.model);
      if (models.length === 1) return new Response("slow down", { status: 429 });
      return sse("app-static.js");
    },
  });
  assert.equal(text, "app-static.js");
  assert.deepEqual(models, ["stealth/space-bunny-alpha", "openai/gpt-4o-mini"]);
});
