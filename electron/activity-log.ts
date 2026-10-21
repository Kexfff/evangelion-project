import {
  activitySchema,
  type Activity,
  type ActivityPage,
} from "../src/shared/autonomy";
import { ProviderChatError } from "./providers";

export function activityPage(
  all: Activity[],
  characterId: string,
  before?: string,
): ActivityPage {
  const entries = all
    .filter((entry) => entry.characterId === characterId)
    .reverse();
  const index = before ? entries.findIndex((entry) => entry.id === before) : -1;
  // An expired cursor must not replay newer entries as if they were older.
  const start = before ? (index < 0 ? entries.length : index + 1) : 0;
  return {
    entries: entries.slice(start, start + 10),
    total: entries.length,
    hasMore: start + 10 < entries.length,
  };
}

/** Never serialize arbitrary Error messages, stacks, upstream bodies, URLs or causes. */
export function activityFailure(error: unknown, cancelled = false) {
  if (cancelled)
    return {
      errorCategory: "cancelled",
      reason:
        "Cancelled locally (for example by user input, pause or a session change).",
    };
  if (error instanceof ProviderChatError) {
    const reasons = {
      http: `Provider rejected the request (HTTP ${error.status ?? "unknown"}). Check request compatibility, credentials and quota.`,
      empty: "Provider completed without usable reply text.",
      truncated:
        "Provider response ended before completion or reached its token limit.",
      blocked: "Provider filtered the response.",
      "invalid-response":
        "Provider returned malformed JSON or an invalid response.",
      "stream-error": "Provider reported an error inside the response stream.",
    };
    return {
      errorCategory: error.kind,
      reason: reasons[error.kind],
      ...(error.status && error.status >= 100 && error.status <= 599
        ? { httpStatus: error.status }
        : {}),
    };
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return {
        errorCategory: "timeout",
        reason: "Provider request timed out (90-second limit).",
      };
    if (error.name === "AbortError")
      return {
        errorCategory: "aborted",
        reason: "Request or response stream was aborted.",
      };
    if (error instanceof SyntaxError)
      return {
        errorCategory: "invalid-response",
        reason: "Response JSON could not be parsed.",
      };
    const codes = new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_SOCKET",
      "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ]);
    const own = (error as Error & { code?: unknown }).code;
    const cause = (error.cause as { code?: unknown } | undefined)?.code;
    const code = [own, cause].find(
      (value): value is string => typeof value === "string" && codes.has(value),
    );
    if (code)
      return {
        errorCategory: "transport",
        transportCode: code,
        reason: `Network/TLS failure (${code}).`,
      };
    if (error instanceof TypeError && error.message === "fetch failed")
      return {
        errorCategory: "transport",
        reason: "Network request failed without an available transport code.",
      };
  }
  return {
    errorCategory: "internal",
    reason:
      "An unclassified local error occurred; see the recorded stage and attempt ID.",
  };
}

export function activityExport(
  all: Activity[],
  appVersion: string,
  platform: string,
  arch: string,
) {
  return {
    format: "evangelion-activity-log",
    version: 1,
    appVersion,
    platform,
    arch,
    exportedAt: new Date().toISOString(),
    retentionLimit: 500,
    scope:
      "All retained Consciousness activity across all characters; not console logs or conversation history. Older evicted events cannot be recovered.",
    privacy:
      "No credentials, prompts or raw provider responses are added by diagnostics. Existing activity descriptions may contain reminder titles or other personal labels; review before sharing.",
    entries: all.map((entry) => activitySchema.parse(entry)),
  };
}
