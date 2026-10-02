import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

type ProfileApp = {
  getPath(name: "userData"): string;
  setPath(name: "userData" | "sessionData", value: string): void;
};

/** Apply before the instance lock, Store, vault or windows, including packaged builds. */
export function configureTestProfile(app: ProfileApp, directory?: string) {
  if (!directory) return;
  if (!path.isAbsolute(directory))
    throw new Error(
      "EVA_TEST_DATA_DIR must be an absolute, disposable directory.",
    );
  // Harnesses create this directory first. Do not silently fall back to the real profile.
  const target = realpathSync(directory);
  const normal = app.getPath("userData");
  const normalPath = existsSync(normal)
    ? realpathSync(normal)
    : path.resolve(normal);
  if (target === normalPath)
    throw new Error(
      "The test profile must not be the normal application profile.",
    );
  const session = path.join(target, "chromium");
  mkdirSync(session, { recursive: true, mode: 0o700 });
  app.setPath("userData", target);
  app.setPath("sessionData", session);
}
