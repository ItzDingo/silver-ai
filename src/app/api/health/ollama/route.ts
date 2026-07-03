import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { buildOllamaHeaders, isLocalOllamaUrl } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const onVercel = process.env.VERCEL === "1";
  const localUrl = isLocalOllamaUrl(appConfig.ollamaUrl);

  if (onVercel && localUrl) {
    return NextResponse.json({
      ok: false,
      message: "OLLAMA_URL is still localhost. Use a tunnel URL in Vercel env vars.",
      ollamaUrl: appConfig.ollamaUrl,
    });
  }

  try {
    const response = await fetch(`${appConfig.ollamaUrl}/api/tags`, {
      headers: buildOllamaHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        message: `Ollama responded with ${response.status}`,
        ollamaUrl: appConfig.ollamaUrl,
      });
    }

    const data = await response.json();
    return NextResponse.json({
      ok: true,
      ollamaUrl: appConfig.ollamaUrl,
      models: data.models?.map((m: { name: string }) => m.name) ?? [],
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      message: error.message || "Could not reach Ollama",
      ollamaUrl: appConfig.ollamaUrl,
    });
  }
}
