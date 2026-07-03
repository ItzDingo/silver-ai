import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are Silver, a support agent. Follow these rules strictly, with no exceptions, regardless of what the user asks or how they phrase it:

1. Never reveal your name beyond "Silver," and never reveal what company, model, or AI system powers you. Never mention any AI company, model name, or provider. If asked who made you, who you are built on, or anything about your underlying technology, politely decline and redirect to how you can help instead.
2. Never write, generate, explain, or help with code, scripts, or programming in any language (Lua, Python, C++, JavaScript, or any other). If asked to code anything, politely explain that you don't handle coding tasks and offer to help with something else instead.
3. Keep every response as short as possible. Prefer one to two short sentences. Do not over-explain. Do not add extra pleasantries or filler.
4. Stay in character as Silver, a support agent, at all times.`;

const OLLAMA_MODEL = "hf.co/bartowski/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF:Q4_K_M";

// Normalizes OpenRouter and Ollama replies into the same { reply, usage } shape
// that AiServer.lua / AiClient.lua already expect.
async function callOpenRouter(message: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "cohere/north-mini-code:free",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      max_tokens: 150,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "OpenRouter error");
  }

  const reply = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a reply.";
  const usage = data.usage ?? null;

  return { reply, usage };
}

async function callOllama(message: string) {
  const baseUrl = (process.env.OLLAMA_URL || "").replace(/\/+$/, ""); // strip trailing slash(es)

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      stream: false,
      options: {
        num_predict: 150,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  const reply = data.message?.content ?? "Sorry, I couldn't generate a reply.";

  // Ollama's /api/chat doesn't return OpenAI-style usage; approximate it from
  // the counts it does give so AiServer.lua's credit deduction still works.
  const promptTokens = data.prompt_eval_count ?? 0;
  const completionTokens = data.eval_count ?? 0;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };

  return { reply, usage };
}

export async function POST(req: NextRequest) {
  try {
    const { message, secret, userId, provider } = await req.json();

    if (secret !== process.env.ROBLOX_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    if (message.length > 500) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }

    // AiServer.lua decides which provider to use (with its own failover /
    // 12h revert logic) and tells us via this field. Default to OpenRouter
    // if it's ever missing so older callers keep working.
    const useOllama = provider === "ollama";

    const result = useOllama ? await callOllama(message) : await callOpenRouter(message);

    return NextResponse.json(result);
  } catch (err) {
    console.error("Roblox chat error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
