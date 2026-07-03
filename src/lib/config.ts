function parseEnvFloat(key: string, fallback: number): number {
  const value = process.env[key]?.trim();
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvInt(key: string, fallback: number): number {
  const value = process.env[key]?.trim();
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const appConfig = {
  ollamaUrl: process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
  ollamaApiKey: process.env.OLLAMA_API_KEY?.trim() || "",
  fastModelName:
    process.env.FAST_MODEL_NAME?.trim() ||
    "hf.co/bartowski/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF:Q4_K_M",
  expertModelName:
    process.env.EXPERT_MODEL_NAME?.trim() ||
    "nvidia/nemotron-3-ultra-550b-a55b:free",
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
  fastModelTemperature: parseEnvFloat("FAST_MODEL_TEMPERATURE", 0.7),
  expertModelTemperature: parseEnvFloat("EXPERT_MODEL_TEMPERATURE", 0.7),
  fastMaxOutputTokens: parseEnvInt("FAST_MAX_OUTPUT_TOKENS", 512),
  expertErrorThreshold: parseEnvInt("EXPERT_ERROR_THRESHOLD", 3),
};
