export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";
/** Text-guided approximation, NOT forced alignment or provider phoneme timing. */
export function visemeAt(
  text: string,
  seconds: number,
  duration: number,
): Viseme | undefined {
  if (!text || seconds < 0 || !Number.isFinite(seconds) || duration <= 0)
    return;
  const chars = [...text.toLocaleLowerCase()];
  const index = Math.min(
    chars.length - 1,
    Math.floor((seconds / duration) * chars.length),
  );
  const c = chars[index];
  if (/\s|[.,!?;:…]/u.test(c)) return;
  if (/[aаやゃあぁ]/u.test(c)) return "aa";
  if (/[iиыいぃ]/u.test(c)) return "ih";
  if (/[uуюうぅ]/u.test(c)) return "ou";
  if (/[eеэえぇ]/u.test(c)) return "ee";
  if (/[oоёおぉ]/u.test(c)) return "oh";
  return /[bmpбмп]/u.test(c) ? undefined : "ih";
}
export function selectGesture(
  text: string,
  mood: number,
  energy: number,
): "greeting" | "peaceSign" | "modelPose" | undefined {
  if (energy < 30) return;
  if (/\?|？/.test(text)) return "modelPose";
  if (mood > 75 && /!|！/.test(text)) return "peaceSign";
  return "greeting";
}
