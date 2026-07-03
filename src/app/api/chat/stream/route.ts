import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { buildSystemPrompt, MAX_OUTPUT_NOTICE } from "@/lib/prompts";
import { buildOllamaFetchInit, getOllamaUnavailableMessage, isLocalOllamaUrl } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Model capability definitions
const MODEL_CAPABILITIES: Record<string, {
  supportsThinking: boolean;
  supportsImages: boolean;
  supportsWebSearch: boolean;
  supportsEffort: boolean;
}> = {
  "hf.co/bartowski/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF:Q4_K_M": {
    supportsThinking: false,
    supportsImages: false,
    supportsWebSearch: true,
    supportsEffort: true,
  },
  "cohere/north-mini-code:free": {
    supportsThinking: false,
    supportsImages: false,
    supportsWebSearch: true,
    supportsEffort: false,
  },
  "nvidia/nemotron-3-ultra-550b-a55b:free": {
    supportsThinking: true,
    supportsImages: false,
    supportsWebSearch: true,
    supportsEffort: true,
  },
};

function getCapabilities(modelName: string) {
  return MODEL_CAPABILITIES[modelName] || {
    supportsThinking: false,
    supportsImages: false,
    supportsWebSearch: false,
    supportsEffort: false,
  };
}

async function searchWeb(query: string): Promise<string> {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      console.warn("[Search] DuckDuckGo HTML request failed.");
      return "No results found.";
    }
    const html = await response.text();
    const snippets: string[] = [];
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    let count = 0;
    while ((match = snippetRegex.exec(html)) !== null && count < 4) {
      const cleanSnippet = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (cleanSnippet) {
        snippets.push(`- ${cleanSnippet}`);
        count++;
      }
    }
    if (snippets.length === 0) {
      // Fallback: parse td result-snippet
      const descRegex = /<td class="result-snippet">([\s\S]*?)<\/td>/gi;
      while ((match = descRegex.exec(html)) !== null && count < 4) {
        const cleanSnippet = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        if (cleanSnippet) {
          snippets.push(`- ${cleanSnippet}`);
          count++;
        }
      }
    }
    return snippets.length > 0 ? snippets.join("\n") : "No results found.";
  } catch (e) {
    console.error("[Search Error]:", e);
    return "Failed to search the web.";
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyJson = await req.json();
    const {
      chatId,
      messages,
      thinkingEnabled,
      reasoningEffort,
      imageData,
      websearchEnabled,
    } = bodyJson;

    // Support direct modelName override from frontend
    const isFast = bodyJson.modelType === "fast";
    const modelSource = isFast ? "ollama" : "openrouter";
    const modelName = isFast
      ? (bodyJson.modelName || appConfig.fastModelName)
      : (bodyJson.modelName || appConfig.expertModelName);
    const capabilities = getCapabilities(modelName);
    const apiKey = isFast ? "" : appConfig.openRouterApiKey;

    if (!isFast && !apiKey) {
      return NextResponse.json(
        {
          error:
            "OpenRouter API key is missing. Set OPENROUTER_API_KEY in .env and restart the dev server.",
        },
        { status: 400 }
      );
    }

    if (isFast && process.env.VERCEL === "1" && isLocalOllamaUrl(appConfig.ollamaUrl)) {
      return NextResponse.json({ error: getOllamaUnavailableMessage() }, { status: 503 });
    }

    console.log(`[Stream API] Request Details:
    - Model Type: ${bodyJson.modelType || "N/A"}
    - Model Source: ${modelSource}
    - Model Name: ${modelName}
    - API Key Source: .env
    - API Key (first 8 / last 4): ${apiKey ? `${apiKey.substring(0, 8)}...${apiKey.slice(-4)}` : "N/A"}
    - Thinking Enabled: ${thinkingEnabled}
    - Reasoning Effort: ${reasoningEffort}
    - Web Search Enabled: ${websearchEnabled}
    - Temperature: ${isFast ? appConfig.fastModelTemperature : appConfig.expertModelTemperature}
    - Fast Max Output Tokens: ${isFast ? appConfig.fastMaxOutputTokens : "N/A"}`);

    // Build messages array and ensure no message has empty content
    const userMessages = messages.map((msg: any) => {
      const textContent = msg.content || msg.thought || "...";
      return {
        role: msg.role,
        content: msg.imageUrl
          ? [
              { type: "text", text: textContent },
              { type: "image_url", image_url: { url: msg.imageUrl } },
            ]
          : textContent,
      };
    });

    // Run Web Search if enabled
    let searchResults = "";
    if (websearchEnabled && capabilities.supportsWebSearch) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
      const queryText = lastUserMsg?.content || "";
      if (queryText) {
        console.log(`[Stream API Web Search] Querying: "${queryText}"...`);
        searchResults = await searchWeb(queryText);
        console.log(`[Stream API Web Search] Finished search.`);
      }
    }

    const systemPromptContent = buildSystemPrompt(isFast, searchResults || undefined);

    const formattedMessages = [
      {
        role: "system",
        content: systemPromptContent
      },
      ...userMessages
    ];

    // Add image if provided with the latest message
    if (imageData && formattedMessages.length > 0) {
      const lastMsg = formattedMessages[formattedMessages.length - 1];
      if (typeof lastMsg.content === "string") {
        lastMsg.content = [
          { type: "text", text: lastMsg.content },
          { type: "image_url", image_url: { url: imageData } },
        ];
      }
    }

    let stream: ReadableStream;

    if (modelSource === "ollama") {
      console.log(`[Stream API] Querying local Ollama endpoint: ${appConfig.ollamaUrl}`);
      stream = await streamFromOllama(
        appConfig.ollamaUrl,
        modelName,
        formattedMessages,
        thinkingEnabled && capabilities.supportsThinking,
        appConfig.fastModelTemperature,
        appConfig.fastMaxOutputTokens
      );
    } else {
      console.log("[Stream API] Querying OpenRouter endpoint...");
      stream = await streamFromOpenRouter(
        apiKey,
        modelName,
        formattedMessages,
        thinkingEnabled && capabilities.supportsThinking,
        capabilities.supportsEffort ? reasoningEffort : undefined,
        appConfig.expertModelTemperature
      );
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[Stream API Error]:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// GET: Return model capabilities
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const fastCaps = getCapabilities(appConfig.fastModelName);
    const expertCaps = getCapabilities(appConfig.expertModelName);

    return NextResponse.json({
      success: true,
      fast: {
        name: appConfig.fastModelName,
        source: "ollama",
        maxOutputTokens: appConfig.fastMaxOutputTokens,
        temperature: appConfig.fastModelTemperature,
        ...fastCaps,
      },
      expert: {
        name: appConfig.expertModelName,
        source: "openrouter",
        temperature: appConfig.expertModelTemperature,
        errorThreshold: appConfig.expertErrorThreshold,
        ...expertCaps,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function streamFromOllama(
  baseUrl: string,
  model: string,
  messages: any[],
  think: boolean,
  temperature: number,
  maxOutputTokens: number
): Promise<ReadableStream> {
  const response = await fetch(`${baseUrl}/api/chat`, buildOllamaFetchInit({
    model,
    messages,
    stream: true,
    options: {
      temperature,
      num_predict: maxOutputTokens,
    },
    ...(think ? { think: true } : {}),
  }));

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error: ${err}`);
  }

  const upstreamReader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let buffer = "";
      let maxTokensReached = false;
      let outputTokenCount = 0;

      const emitTokenCount = () => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "token_count",
              count: outputTokenCount,
              limit: maxOutputTokens,
            })}\n\n`
          )
        );
      };

      try {
        while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) {
            if (maxTokensReached) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "max_tokens_reached", message: MAX_OUTPUT_NOTICE })}\n\n`
                )
              );
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const json = JSON.parse(trimmed);

              if (json.message?.content) {
                outputTokenCount += 1;
                const event = {
                  type: "content",
                  content: json.message.content,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                emitTokenCount();
              }

              if (json.message?.thinking) {
                const event = {
                  type: "thinking",
                  content: json.message.thinking,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }

              if (json.done) {
                if (typeof json.eval_count === "number") {
                  outputTokenCount = json.eval_count;
                  emitTokenCount();
                }

                if (json.done_reason === "length" || outputTokenCount >= maxOutputTokens) {
                  maxTokensReached = true;
                }

                const metricsEvent = {
                  type: "metrics",
                  total_duration: json.total_duration,
                  eval_count: json.eval_count,
                  eval_duration: json.eval_duration,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(metricsEvent)}\n\n`));

                if (maxTokensReached) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "max_tokens_reached", message: MAX_OUTPUT_NOTICE })}\n\n`
                    )
                  );
                }

                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                return;
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (err) {
        console.error("[Ollama] Stream read error:", err);
        controller.error(err);
      }
    },
    cancel() {
      upstreamReader.cancel();
    }
  });
}

async function streamFromOpenRouter(
  apiKey: string,
  model: string,
  messages: any[],
  think: boolean,
  effort: string | undefined,
  temperature: number
): Promise<ReadableStream> {
  const body: any = {
    model,
    messages,
    stream: true,
    temperature,
  };

  // Add reasoning/thinking parameters if supported
  if (think) {
    body.reasoning = {};
    if (effort && effort !== "auto") {
      body.reasoning.effort = effort === "max" ? "high" : effort;
    }
  }

  console.log("[OpenRouter] Sending request body:", JSON.stringify({
    model: body.model,
    stream: body.stream,
    temperature: body.temperature,
    reasoning: body.reasoning,
  }));

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXTAUTH_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
      "X-Title": "Silver Chat",
    },
    body: JSON.stringify(body),
  });

  console.log(`[OpenRouter API Response]:
  - Status Code: ${response.status}
  - Status Text: ${response.statusText}
  - Headers Content-Type: ${response.headers.get("content-type")}`);

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) {
      throw new Error(
        "OpenRouter API key is invalid or expired. Update OPENROUTER_API_KEY in .env and restart the dev server."
      );
    }
    throw new Error(`OpenRouter error: ${err}`);
  }

  const upstreamReader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let buffer = "";
      let closed = false;
      try {
        while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) {
            console.log("[OpenRouter] Upstream stream ended.");
            if (!closed) {
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              controller.close();
              closed = true;
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              if (!closed) {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                closed = true;
              }
              return;
            }

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;

              if (delta?.reasoning_content || delta?.reasoning) {
                const event = {
                  type: "thinking",
                  content: delta.reasoning_content || delta.reasoning,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }

              if (delta?.content) {
                const event = {
                  type: "content",
                  content: delta.content,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }

              if (json.usage) {
                const metricsEvent = {
                  type: "metrics",
                  prompt_tokens: json.usage.prompt_tokens,
                  completion_tokens: json.usage.completion_tokens,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(metricsEvent)}\n\n`));
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      } catch (err) {
        console.error("[OpenRouter] Stream read error:", err);
        controller.error(err);
      }
    },
    cancel() {
      upstreamReader.cancel();
    }
  });
}

