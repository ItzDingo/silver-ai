/** Rough token estimate for expert mode when the provider does not report usage yet. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}
