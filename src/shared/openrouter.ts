import { z } from "zod";

export const openRouterModelSchema = z
  .string()
  .max(200)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/,
    "Enter an OpenRouter model ID in author/model format.",
  );
export const openRouterTagSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:/-]+$/);
export const openRouterSelectionsSchema = z
  .record(
    openRouterModelSchema,
    z
      .array(openRouterTagSchema)
      .min(
        1,
        "Choose at least one OpenRouter provider, or use automatic routing.",
      )
      .max(100),
  )
  .refine(
    (v) => Object.keys(v).length <= 100,
    "Keep provider choices for at most 100 models.",
  );

export function isOpenRouter(base: string) {
  try {
    const url = new URL(base);
    return (
      url.origin === "https://openrouter.ai" &&
      url.pathname.replace(/\/+$/, "") === "/api/v1" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export interface OpenRouterEndpoint {
  id: string;
  name: string;
  tools: boolean;
  inputPrice?: string;
  outputPrice?: string;
}
