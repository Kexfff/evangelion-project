import { z } from "zod";
import { ProviderChatError } from "./providers";

export class MemoryFormatError extends Error {
  constructor() {
    super("The model did not return a valid memory fact list.");
  }
}

/** Accept common JSON envelopes, never recover facts from partial JSON or reasoning. */
export function parseMemoryFacts(output: string): string[] {
  if (output.length > 32000) throw new MemoryFormatError();
  const text = output.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const fences = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
    if (fences.length !== 1 || text.includes("<think>"))
      throw new MemoryFormatError();
    try {
      value = JSON.parse(fences[0][1].trim());
    } catch {
      throw new MemoryFormatError();
    }
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "facts" in value
  )
    value = value.facts;
  const parsed = z.array(z.string().trim().max(300)).max(20).safeParse(value);
  if (!parsed.success) throw new MemoryFormatError();
  const seen = new Set<string>();
  return parsed.data
    .filter((fact) => {
      if (!fact || seen.has(fact.toLocaleLowerCase())) return false;
      seen.add(fact.toLocaleLowerCase());
      return true;
    })
    .slice(0, 3);
}

/** Allowlist error descriptions; do not expose model output, URLs or upstream bodies. */
export function memoryFailureReason(error: unknown) {
  if (error instanceof MemoryFormatError)
    return "the model returned an invalid fact list after one retry";
  if (error instanceof ProviderChatError) {
    if (error.kind === "truncated")
      return "the model exhausted the extraction token budget after one retry";
    if (error.kind === "empty")
      return "the model returned no extraction text after one retry";
    if (error.kind === "http")
      return `the extraction request returned HTTP ${error.status}; check provider credentials, quota and model settings`;
    if (error.kind === "blocked")
      return "the provider blocked the extraction response";
    return "the provider returned an invalid API response";
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
    return "the extraction request timed out";
  return "the extraction request or local save failed; check provider connectivity and local storage";
}
