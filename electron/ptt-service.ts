import {
  PttEdges,
  pttLabel,
  type PttConfig,
  type PttStatus,
  type PttAction,
} from "../src/shared/ptt";

export interface ShortcutBinding {
  close(): void;
}
export type BindShortcut = (
  config: PttConfig,
  edge: (down: boolean) => void,
  changed: (label: string | null) => void,
  signal: AbortSignal,
) => Promise<ShortcutBinding>;

/** Owns registration, cancellation, and a mic-free diagnostic mode. No key logging. */
export class PttService {
  status: PttStatus = {
    state: "off",
    message: "Keyboard control is off.",
    testing: false,
  };
  private config?: PttConfig;
  private controller?: AbortController;
  private binding?: ShortcutBinding;
  private edges?: PttEdges;
  private testTimer?: ReturnType<typeof setTimeout>;
  private suspended = false;
  constructor(
    private bind: BindShortcut,
    private emit: (action: PttAction) => void,
    private publish: (s: PttStatus) => void,
  ) {}
  private update(patch: Partial<PttStatus>) {
    this.status = { ...this.status, ...patch };
    this.publish(this.status);
  }
  async configure(config: PttConfig, force = false) {
    if (!force && JSON.stringify(config) === JSON.stringify(this.config))
      return;
    this.close();
    this.config = { ...config };
    this.status = {
      state: "off",
      message: "Keyboard control is off.",
      testing: false,
    };
    if (!config.enabled) {
      this.update({});
      return;
    }
    if (this.suspended) {
      this.update({
        state: "suspended",
        message: "Keyboard control paused while locked or suspended.",
      });
      return;
    }
    const controller = (this.controller = new AbortController());
    this.edges = new PttEdges(config.mode, (action) => {
      if (!this.status.testing) this.emit(action);
    });
    if (config.scope === "app") {
      this.update({
        state: "ready",
        binding: pttLabel(config),
        message:
          "App-focused: use the key in the companion window, outside text fields.",
      });
      return;
    }
    this.update({
      state: "registering",
      binding: pttLabel(config),
      message:
        "Requesting a global shortcut. Check for a desktop permission dialog.",
    });
    try {
      const binding = await this.bind(
        config,
        (down) => {
          if (controller.signal.aborted || this.status.state !== "ready")
            return;
          this.update({ lastEdge: down ? "pressed" : "released" });
          if (down) this.edges?.press();
          else this.edges?.release();
        },
        (label) => {
          if (controller.signal.aborted) return;
          if (label === null) {
            this.edges?.cancel();
            this.update({
              state: "unavailable",
              message:
                "Desktop shortcut unavailable or revoked. Retry, or choose app-focused mode.",
            });
          } else {
            if (this.status.state === "ready" && this.status.binding !== label)
              this.edges?.cancel();
            this.update({ binding: label });
          }
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        binding.close();
        return;
      }
      this.binding = binding;
      this.update({
        state: "ready",
        message:
          "Registered globally. Test press and release before using it in a game.",
      });
    } catch (error) {
      if (!controller.signal.aborted)
        this.update({
          state: "unavailable",
          message:
            error instanceof Error
              ? error.message
              : "Shortcut registration failed.",
        });
    }
  }
  test(testing: boolean) {
    if (this.status.testing === testing) return;
    this.emit("cancel");
    this.edges?.cancel();
    clearTimeout(this.testTimer);
    this.update({ testing, lastEdge: undefined });
    if (testing) this.testTimer = setTimeout(() => this.test(false), 30000);
  }
  cancel() {
    this.emit("cancel");
    this.edges?.cancel();
  }
  settled() {
    this.edges?.settled();
  }
  suspend(value: boolean) {
    this.suspended = value;
    if (this.config) void this.configure(this.config, true);
  }
  close() {
    clearTimeout(this.testTimer);
    this.controller?.abort();
    this.binding?.close();
    this.binding = undefined;
    this.edges?.cancel();
    this.edges = undefined;
    this.emit("cancel");
  }
}
