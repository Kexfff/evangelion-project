import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { NavigationProgress } from "../electron/minecraft-progress";

describe("observed navigation progress", () => {
  it("counts real travel including detours away from a destination", () => {
    const progress = new NavigationProgress(new Vec3(0, 64, 0));
    expect(progress.observe(new Vec3(-1, 64, 0))).toBe(true);
    expect(progress.observe(new Vec3(-2, 64, 0))).toBe(true);
    expect(progress.observe(new Vec3(-2, 64, 1))).toBe(true);
  });
  it("does not count stationary ticks or jitter across a block boundary", () => {
    const progress = new NavigationProgress(new Vec3(0.99, 64, 0));
    for (let i = 0; i < 100; i++) {
      expect(progress.observe(new Vec3(1.01, 64.1, 0))).toBe(false);
      expect(progress.observe(new Vec3(0.99, 64, 0))).toBe(false);
    }
  });
  it("does not reset progress for a repeated small movement loop", () => {
    const progress = new NavigationProgress(new Vec3(0, 64, 0));
    expect(progress.observe(new Vec3(1, 64, 0))).toBe(true);
    expect(progress.observe(new Vec3(1, 64, 1))).toBe(true);
    for (let i = 0; i < 100; i++)
      for (const p of [
        new Vec3(0, 64, 0),
        new Vec3(1, 64, 0),
        new Vec3(1, 64, 1),
      ])
        expect(progress.observe(p)).toBe(false);
  });
});
