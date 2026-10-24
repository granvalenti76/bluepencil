// Fake llama-server for the e2e tests and for trying the app without a model: `node packages/server/test/fake-llm-server.ts`.
import { startFakeLlm } from "./fake-llm.ts";
import { scriptedChat } from "./fake-llm-script.ts";

const port = Number(process.env.FAKE_LLM_PORT ?? 4499);
const fake = await startFakeLlm({
  port,
  models: [process.env.FAKE_LLM_MODEL ?? "Qwen3.6-35B"],
  chat: scriptedChat,
  chunkDelayMs: Number(process.env.FAKE_LLM_CHUNK_DELAY_MS ?? 0),
});
console.log(`Finto llama-server su ${fake.url}`);
const stop = () => void fake.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
