# Starts the local Ollama tunnel proxy so Vercel can reach your PC's Ollama.
# Requires: Ollama running locally, Node.js, and ngrok or cloudflared installed.

$ErrorActionPreference = "Stop"

if (-not $env:OLLAMA_API_KEY) {
  $env:OLLAMA_API_KEY = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  Write-Host "Generated OLLAMA_API_KEY: $env:OLLAMA_API_KEY"
  Write-Host "Save this key — you need the same value in Vercel environment variables."
  Write-Host ""
}

Write-Host "Starting Ollama tunnel proxy on http://127.0.0.1:11435 ..."
Write-Host "In another terminal, run:  ngrok http 11435"
Write-Host "Then set OLLAMA_URL to the ngrok HTTPS URL in Vercel."
Write-Host ""

node "$PSScriptRoot\ollama-tunnel-proxy.mjs"
