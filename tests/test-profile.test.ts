import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureTestProfile } from "../electron/test-profile";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(isPackaged = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "eva-profile-test-"));
  roots.push(root);
  const normal = path.join(root, "normal"),
    isolated = path.join(root, "isolated");
  mkdirSync(normal);
  mkdirSync(isolated);
  return {
    root,
    normal,
    isolated,
    app: { isPackaged, getPath: () => normal, setPath: vi.fn() },
  };
}
describe("smoke profile isolation", () => {
  it.each([false, true])(
    "isolates application and Chromium data with isPackaged=%s",
    (packaged) => {
      const f = fixture(packaged);
      configureTestProfile(f.app, f.isolated);
      expect(f.app.setPath.mock.calls).toEqual([
        ["userData", f.isolated],
        ["sessionData", path.join(f.isolated, "chromium")],
      ]);
    },
  );
  it("leaves ordinary launches unchanged", () => {
    const f = fixture();
    configureTestProfile(f.app);
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
  it("fails closed for relative, nonexistent and real-profile targets", () => {
    const f = fixture();
    for (const target of [
      "relative-profile",
      path.join(f.root, "missing"),
      f.normal,
    ])
      expect(() => configureTestProfile(f.app, target)).toThrow();
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
  it("rejects symlinks to the real profile", () => {
    const f = fixture(),
      link = path.join(f.root, "alias");
    symlinkSync(f.normal, link, "dir");
    expect(() => configureTestProfile(f.app, link)).toThrow(
      "normal application profile",
    );
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
});
