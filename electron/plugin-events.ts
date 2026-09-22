import type { CompanionEvent } from "../src/shared/plugins";

/** Synchronous, payload-minimal bus. Subscribers cannot fail a conversation. */
export class PluginEvents {
  private listeners = new Set<(event: CompanionEvent) => void>();
  on(listener: (event: CompanionEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: CompanionEvent) {
    for (const listener of this.listeners) {
      try {
        listener(Object.freeze({ ...event }));
      } catch {
        /* Isolate observers. */
      }
    }
  }
}
