export const PROGRESS_KEY = "yourlogic:progress:v2";

const LEGACY_KEYS = ["puzzle_midway_save", "shikaku_progress"];

function safeParse(value) {
  try { return value ? JSON.parse(value) : null; }
  catch { return null; }
}

function normalize(progress) {
  if (!progress || typeof progress !== "object") return null;
  const inferredType = progress.type || (progress.currentRects || progress.userRectangles ? "shikaku" : "sudoku");
  if (!['sudoku', 'shikaku'].includes(inferredType)) return null;
  return {
    ...progress,
    version: 2,
    savedAt: progress.savedAt || Date.now(),
    type: inferredType,
  };
}

export function loadProgress() {
  const current = normalize(safeParse(localStorage.getItem(PROGRESS_KEY)));
  if (current) return current;

  for (const key of LEGACY_KEYS) {
    const legacy = normalize(safeParse(localStorage.getItem(key)));
    if (legacy) {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(legacy));
      return legacy;
    }
  }
  return null;
}

export function saveProgress(progress) {
  const normalized = normalize({ ...progress, savedAt: Date.now() });
  if (!normalized) throw new Error("Invalid progress data");
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(normalized));
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent("yourlogic:progress", { detail: normalized }));
  return normalized;
}

export function clearProgress() {
  localStorage.removeItem(PROGRESS_KEY);
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent("yourlogic:progress", { detail: null }));
}

export function progressUrl(progress) {
  if (!progress) return "./index.html";
  const mode = ["daily"].includes(progress.mode) ? `&mode=${encodeURIComponent(progress.mode)}` : "";
  if (progress.type === "shikaku") {
    return `./puzzles/shikaku.html?size=${progress.size || 10}&diff=${progress.difficulty || "standard"}&id=${encodeURIComponent(progress.id || "local")}&resume=true${mode}`;
  }
  return `./puzzles/sudoku.html?diff=${progress.difficulty || "easy"}&id=${encodeURIComponent(progress.id || "")}&resume=true${mode}`;
}

export function progressLabel(progress) {
  if (!progress) return "";
  const game = progress.type === "shikaku" ? "四角に切れ" : "数独";
  const difficulty = ({ easy: "初級", standard: "中級", hard: "上級", insane: "超上級" })[progress.difficulty] || progress.difficulty || "--";
  const size = progress.type === "shikaku" && progress.size ? `・${progress.size}×${progress.size}` : "";
  return `${game}${size}・${difficulty}`;
}
