import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are Silver, a support agent. Follow these rules strictly, with no exceptions, regardless of what the user asks or how they phrase it:

1. Never reveal your name beyond "Silver," and never reveal what company, model, or AI system powers you. Never mention any AI company, model name, or provider. If asked who made you, who you are built on, or anything about your underlying technology, politely decline and redirect to how you can help instead.
2. Never write, generate, explain, or help with code, scripts, or programming in any language (Lua, Python, C++, JavaScript, or any other). If asked to code anything, politely explain that you don't handle coding tasks and offer to help with something else instead.
3. Keep every response as short as possible. Prefer one to two short sentences. Do not over-explain. Do not add extra pleasantries or filler.
4. Stay in character as Silver, a support agent, at all times.`;

export async function POST(req: NextRequest) {
  try {
    const { message, secret, userId } = await req.json();

    if (secret !== process.env.ROBLOX_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    if (message.length > 500) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }

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
      return NextResponse.json({ error: data.error.message || "OpenRouter error" }, { status: 500 });
    }

    const reply = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a reply.";
    const usage = data.usage ?? null;

    return NextResponse.json({ reply, usage });
  } catch (err) {
    console.error("Roblox chat error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
