import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";

/** A deliberately bounded JSON Schema subset for external tool inputs and outputs. */
export function compileBoundedSchema(schema: Record<string, unknown>) {
  if (JSON.stringify(schema).length > 16000)
    throw new Error("Schema too large");
  let nodes = 0;
  function check(value: unknown, depth = 0) {
    if (++nodes > 1500 || depth > 16) throw new Error("Schema too complex");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (["$ref", "$dynamicRef", "pattern", "format"].includes(key) &&
          typeof child === "string") ||
        key === "patternProperties"
      )
        throw new Error("Unsupported schema feature");
      check(child, depth + 1);
    }
  }
  check(schema);
  const Validator =
    typeof schema.$schema === "string" && schema.$schema.includes("draft-07")
      ? Ajv
      : Ajv2020;
  return new Validator({
    strict: false,
    allErrors: false,
    validateFormats: false,
    ownProperties: true,
  }).compile(schema);
}

export const boundedSchemaValidator: jsonSchemaValidator = {
  getValidator<T>(schema: Record<string, unknown>) {
    const validate = compileBoundedSchema(schema);
    return (input: unknown) =>
      validate(input)
        ? { valid: true as const, data: input as T, errorMessage: undefined }
        : {
            valid: false as const,
            data: undefined,
            errorMessage: "Tool output does not match its schema",
          };
  },
};
