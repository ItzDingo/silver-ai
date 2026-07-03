#!/usr/bin/env node
/**
 * Local Ollama tunnel proxy for Vercel deployment.
 *
 * 1. Start Ollama on your PC (default http://127.0.0.1:11434)
 * 2. Run: OLLAMA_API_KEY=your-secret node scripts/ollama-tunnel-proxy.mjs
 * 3. Expose port 11435 with ngrok or Cloudflare Tunnel
 * 4. Set Vercel env:
 *    OLLAMA_URL=https://your-public-tunnel-url
 *    OLLAMA_API_KEY=your-secret
 */
import http from "http";

const API_KEY = process.env.OLLAMA_API_KEY?.trim();
const LISTEN_PORT = Number(process.env.OLLAMA_PROXY_PORT || 11435);
const TARGET = process.env.OLLAMA_TARGET || "http://127.0.0.1:11434";

const target = new URL(TARGET);

const server = http.createServer((clientReq, clientRes) => {
  if (API_KEY) {
    const auth = clientReq.headers.authorization;
    if (auth !== `Bearer ${API_KEY}`) {
      clientRes.writeHead(401, { "Content-Type": "text/plain" });
      clientRes.end("Unauthorized");
      return;
    }
  }

  const requestPath = clientReq.url || "/";
  const proxyHeaders = { ...clientReq.headers, host: `${target.hostname}:${target.port || 80}` };

  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: target.port || 11434,
      path: requestPath,
      method: clientReq.method,
      headers: proxyHeaders,
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(clientRes);
    }
  );

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502, { "Content-Type": "text/plain" });
    clientRes.end(`Ollama proxy error: ${err.message}`);
  });

  clientReq.pipe(proxyReq);
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`Ollama tunnel proxy: http://127.0.0.1:${LISTEN_PORT} -> ${TARGET}`);
  console.log(API_KEY ? "API key auth: enabled" : "API key auth: disabled (set OLLAMA_API_KEY)");
  console.log("");
  console.log("Next steps:");
  console.log(`  ngrok http ${LISTEN_PORT}`);
  console.log("  or: cloudflared tunnel --url http://127.0.0.1:" + LISTEN_PORT);
  console.log("");
  console.log("Then set in Vercel:");
  console.log("  OLLAMA_URL=<your public tunnel URL>");
  console.log("  OLLAMA_API_KEY=<same secret as above>");
});
