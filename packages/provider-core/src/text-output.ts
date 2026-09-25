/** Accepts bare JSON or JSON wrapped in one code fence; nothing else. Shared by
 * every CLI subscription transport that asks a model for strict JSON. */
export function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}
