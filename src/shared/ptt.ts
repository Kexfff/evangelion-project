import { z } from "zod";

// Deliberately bounded, portable key vocabulary. No arbitrary Electron accelerators.
export const pttKeySchema = z
  .string()
  .regex(
    /^(?:|[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Backquote|(?:Shift|Control|Alt|Meta)(?:Left|Right))$/,
  );
export const pttConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["hold", "toggle"]).default("hold"),
    scope: z.enum(["global", "app"]).default("app"),
    key: pttKeySchema.default("ShiftRight"),
    ctrl: z.boolean().default(false),
    alt: z.boolean().default(false),
    shift: z.boolean().default(false),
    meta: z.boolean().default(false),
  })
  .refine(
    (v) => !v.enabled || !!v.key,
    "Choose a key before enabling press-to-talk.",
  );
export type PttConfig = z.infer<typeof pttConfigSchema>;
export type PttAction = "start" | "finish" | "cancel";
export interface PttStatus {
  state: "off" | "registering" | "ready" | "unavailable" | "suspended";
  message: string;
  binding?: string;
  testing: boolean;
  lastEdge?: "pressed" | "released";
}
export const pttLabel = (c: PttConfig) =>
  [
    c.ctrl && "Ctrl",
    c.alt && "Alt",
    c.shift && "Shift",
    c.meta && "Super",
    c.key.replace(/(Shift|Control|Alt|Meta)(Left|Right)/, "$2 $1"),
  ]
    .filter(Boolean)
    .join("+");
export const pttPortalTrigger = (c: PttConfig) =>
  [
    c.ctrl && "CTRL",
    c.alt && "ALT",
    c.shift && "SHIFT",
    c.meta && "LOGO",
    c.key === "Space"
      ? "space"
      : c.key === "Backquote"
        ? "grave"
        : /^[A-Z]$/.test(c.key)
          ? c.key.toLowerCase()
          : c.key
              .replace("Meta", "Super")
              .replace("Right", "_R")
              .replace("Left", "_L"),
  ]
    .filter(Boolean)
    .join("+");
export function pttModifiers(
  e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  key: string,
) {
  return {
    ctrl: e.ctrlKey && !key.startsWith("Control"),
    alt: e.altKey && !key.startsWith("Alt"),
    shift: e.shiftKey && !key.startsWith("Shift"),
    meta: e.metaKey && !key.startsWith("Meta"),
  };
}
export function pttKey(event: Pick<KeyboardEvent, "code">) {
  const code = event.code.replace(/^Key|^Digit/, "");
  return pttKeySchema.safeParse(code).success ? code : "";
}
export function pttMatches(event: KeyboardEvent, c: PttConfig) {
  const m = pttModifiers(event, c.key);
  return (
    pttKey(event) === c.key &&
    m.ctrl === c.ctrl &&
    m.alt === c.alt &&
    m.shift === c.shift &&
    m.meta === c.meta
  );
}

// Shared edge semantics: repeats do not toggle, releasing modifiers first is safe.
export class PttEdges {
  private down = false;
  private recording = false;
  constructor(
    private mode: PttConfig["mode"],
    private emit: (action: PttAction) => void,
  ) {}
  press() {
    if (this.down) return;
    this.down = true;
    if (this.mode === "toggle" && this.recording) {
      this.recording = false;
      this.emit("finish");
    } else {
      this.recording = true;
      this.emit("start");
    }
  }
  release() {
    if (!this.down) return;
    this.down = false;
    if (this.mode === "hold" && this.recording) {
      this.recording = false;
      this.emit("finish");
    }
  }
  cancel() {
    this.down = this.recording = false;
    this.emit("cancel");
  }
  settled() {
    this.recording = false;
  }
}
