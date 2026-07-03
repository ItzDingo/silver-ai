import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { message, secret, userId } = await req.json();

    console.log("Received secret:", JSON.stringify(secret));
    console.log("Expected secret:", JSON.stringify(process.env.ROBLOX_SHARED_SECRET));

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
        model: "cohere/north-mini-code:free", // e.g. "openai/gpt-4o-mini" - use whatever "Expert" uses
        messages: [{ role: "user", content: message }],
        max_tokens: 500,
      }),
    });

    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message || "OpenRouter error" }, { status: 500 });
    }

    const reply = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a reply.";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Roblox chat error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
