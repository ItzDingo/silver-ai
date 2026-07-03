import { appConfig } from "@/lib/config";

export function isLocalOllamaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return true;
  }
}

export function getOllamaUnavailableMessage(): string {
  return "Fast mode is unavailable: OLLAMA_URL points to localhost, which Vercel cannot reach. Run the Ollama tunnel proxy on your PC, expose it with ngrok or Cloudflare Tunnel, and set OLLAMA_URL (and OLLAMA_API_KEY) in Vercel environment variables.";
}

export function buildOllamaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (appConfig.ollamaApiKey) {
    headers.Authorization = `Bearer ${appConfig.ollamaApiKey}`;
  }

  if (appConfig.ollamaUrl.includes("ngrok")) {
    headers["ngrok-skip-browser-warning"] = "1";
  }

  return headers;
}

export function buildOllamaFetchInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: buildOllamaHeaders(),
    body: JSON.stringify(body),
  };
}
