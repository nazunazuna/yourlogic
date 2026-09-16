import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, fetchPuzzleById, markPuzzleFinished, saveClearRecord } from "../../services/firebaseService.js";
import { clearProgress, loadProgress, saveProgress } from "../../core/progressStore.js";
import { bindUndoShortcut, createUndoHistory } from "../../core/historyStore.js";
import { getShikakuHint } from "./shikakuHint.js";

const params = new URLSearchParams(location.search);
const allowedSizes = [5, 10, 15, 20, 25, 30, 40, 50];
const requestedSize = Number(params.get("size")) || 10;
let size = allowedSizes.includes(requestedSize) ? requestedSize : 10;
let difficulty = ["easy", "standard", "hard", "insane"].includes(params.get("diff")) ? params.get("diff") : "standard";
const id = params.get("id");
const resuming = params.get("resume") === "true";
const difficultyNames = { easy: "初級", standard: "中級", hard: "上級", insane: "超上級" };

const board = document.getElementById("board");
const loading = document.getElementById("loading");
const message = document.getElementById("message");
const timer = document.getElementById("timer");
const undoButton = document.getElementById("undo-btn");
const cells = [];
let boardNumbers = [];
let solutionRects = [];
let userRects = [];
let draftEdges = new Set();
let draftOverlay = null;
let mode = "draw";
let dragStart = null;
let dragEnd = null;
let dragPath = [];
let elapsed = 0;
let startedAt = Date.now();
let timerId = null;
let finished = false;
let currentUser = null;

onAuthStateChanged(auth, (user) => { currentUser = user; });

function pointKey(point) { return `${point.x},${point.y}`; }
function parsePoint(value) {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
}
function edgeKey(a, b) {
  return pointKey(a) < pointKey(b) ? `${pointKey(a)}|${pointKey(b)}` : `${pointKey(b)}|${pointKey(a)}`;
}
function parseEdge(value) {
  const [a, b] = value.split("|");
  return [parsePoint(a), parsePoint(b)];
}
function normalizedRect(a, b) {
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
}
function overlaps(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}
function inside(point, rect) {
  return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}
function eachCell(rect, callback) {
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) callback(x, y);
  }
}
function sameState(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function showMessage(text, tone = "") {
  message.textContent = text;
  message.className = `notice ${tone === "hint" ? "" : tone}`.trim();
  message.hidden = !text;
}

function snapshot() {
  return {
    userRects: userRects.map((rect) => ({ ...rect })),
    draftEdges: [...draftEdges],
  };
}

function applySnapshot(saved) {
  userRects = (saved.userRects || []).map((rect) => ({ ...rect }));
  draftEdges = new Set(saved.draftEdges || []);
  clearHighlights();
  render();
  persist();
}

const history = createUndoHistory({
  apply: applySnapshot,
  onChange: ({ canUndo }) => { undoButton.disabled = !canUndo || finished; },
});
function undo() {
  if (finished) return;
  if (history.undo()) showMessage("一つ前の状態に戻しました。");
}
undoButton.addEventListener("click", undo);
bindUndoShortcut(document, undo);

function createSvgLine(a, b, preview = false) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(a.x + .5));
  line.setAttribute("y1", String(a.y + .5));
  line.setAttribute("x2", String(b.x + .5));
  line.setAttribute("y2", String(b.y + .5));
  line.setAttribute("class", `draft-line${preview ? " preview-line" : ""}`);
  return line;
}

function pathSegments(path) {
  const result = [];
  for (let i = 1; i < path.length; i++) result.push([path[i - 1], path[i]]);
  return result;
}

function renderDraftLines(previewPath = []) {
  if (!draftOverlay) return;
  draftOverlay.replaceChildren();
  draftEdges.forEach((value) => {
    const [a, b] = parseEdge(value);
    draftOverlay.append(createSvgLine(a, b));
  });
  pathSegments(previewPath).forEach(([a, b]) => draftOverlay.append(createSvgLine(a, b, true)));
}

function createBoard() {
  board.innerHTML = "";
  cells.length = 0;
  board.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${size}, minmax(0, 1fr))`;
  board.style.setProperty("--cell-font", `${Math.max(7, Math.min(20, 280 / size))}px`);
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.setAttribute("role", "gridcell");
      if (boardNumbers[y][x]) cell.textContent = boardNumbers[y][x];
      board.append(cell);
      row.push(cell);
    }
    cells.push(row);
  }
  draftOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  draftOverlay.setAttribute("class", "draft-overlay");
  draftOverlay.setAttribute("viewBox", `0 0 ${size} ${size}`);
  draftOverlay.setAttribute("aria-hidden", "true");
  board.append(draftOverlay);
  loading.hidden = true;
  board.hidden = false;
  render();
}

function clearHighlights() {
  board.querySelectorAll(".preview,.hint-area,.hint-number,.error").forEach((cell) => {
    cell.classList.remove("preview", "hint-area", "hint-number", "error");
  });
}

function render() {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      cells[y][x].classList.remove("preview", "b-top", "b-right", "b-bottom", "b-left", "answer");
    }
  }
  userRects.forEach((rect) => eachCell(rect, (x, y) => {
    if (y === rect.y1) cells[y][x].classList.add("b-top");
    if (x === rect.x2) cells[y][x].classList.add("b-right");
    if (y === rect.y2) cells[y][x].classList.add("b-bottom");
    if (x === rect.x1) cells[y][x].classList.add("b-left");
  }));
  renderDraftLines();
}

function previewRect(rect) {
  board.querySelectorAll(".preview").forEach((cell) => cell.classList.remove("preview"));
  eachCell(rect, (x, y) => cells[y][x].classList.add("preview"));
}

function cellFromEvent(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
  if (!element || !board.contains(element)) return null;
  return { x: Number(element.dataset.x), y: Number(element.dataset.y) };
}

// Pointer moveが複数マスを飛び越えても、通過セルを途切れず補います。
function cellsBetween(a, b) {
  const result = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const sx = x < b.x ? 1 : -1;
  const dy = -Math.abs(b.y - y);
  const sy = y < b.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push({ x, y });
    if (x === b.x && y === b.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
  return result;
}

board.addEventListener("pointerdown", (event) => {
  if (finished) return;
  const coord = cellFromEvent(event);
  if (!coord) return;
  event.preventDefault();
  board.setPointerCapture?.(event.pointerId);
  clearHighlights();
  dragStart = coord;
  dragEnd = coord;
  dragPath = [coord];
  if (mode === "draft") renderDraftLines(dragPath);
  else previewRect(normalizedRect(dragStart, dragEnd));
});

board.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  const coord = cellFromEvent(event);
  if (!coord || (coord.x === dragEnd.x && coord.y === dragEnd.y)) return;
  if (mode === "draft") {
    const between = cellsBetween(dragEnd, coord).slice(1);
    dragPath.push(...between);
    renderDraftLines(dragPath);
  } else {
    previewRect(normalizedRect(dragStart, coord));
  }
  dragEnd = coord;
});

function completeDrag() {
  if (!dragStart || !dragEnd) return;
  const before = snapshot();
  const rect = normalizedRect(dragStart, dragEnd);
  board.querySelectorAll(".preview").forEach((cell) => cell.classList.remove("preview"));

  if (mode === "draw") {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    userRects.push(rect);
    draftEdges = new Set([...draftEdges].filter((value) => {
      const [a, b] = parseEdge(value);
      return !(inside(a, rect) && inside(b, rect));
    }));
  } else if (mode === "draft") {
    const segments = pathSegments(dragPath);
    if (segments.length) {
      const add = segments.some(([a, b]) => !draftEdges.has(edgeKey(a, b)));
      segments.forEach(([a, b]) => {
        const value = edgeKey(a, b);
        if (add) draftEdges.add(value);
        else draftEdges.delete(value);
      });
    }
  } else {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    draftEdges = new Set([...draftEdges].filter((value) => {
      const [a, b] = parseEdge(value);
      return !(inside(a, rect) || inside(b, rect));
    }));
  }

  dragStart = dragEnd = null;
  dragPath = [];
  const after = snapshot();
  if (!sameState(before, after)) history.record(before);
  render();
  persist();
}

board.addEventListener("pointerup", completeDrag);
board.addEventListener("pointercancel", () => {
  dragStart = dragEnd = null;
  dragPath = [];
  render();
});

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  document.querySelectorAll(".mode").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}));

function persist() {
  if (finished || !id || !boardNumbers.length) return;
  saveProgress({
    type: "shikaku",
    id,
    size,
    difficulty,
    elapsedTime: elapsed,
    boardNumbers,
    solutionRects,
    userRectangles: userRects,
    draftEdges: [...draftEdges],
  });
}

function validate() {
  const coverage = Array.from({ length: size }, () => Array(size).fill(0));
  const errors = [];
  for (const rect of userRects) {
    const numbers = [];
    eachCell(rect, (x, y) => {
      coverage[y][x]++;
      if (boardNumbers[y][x]) numbers.push(boardNumbers[y][x]);
    });
    const rectArea = (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
    if (numbers.length !== 1 || numbers[0] !== rectArea) errors.push(rect);
  }
  const uncovered = coverage.flat().some((count) => count !== 1);
  return { valid: !errors.length && !uncovered, errors, uncovered };
}

document.getElementById("check-btn").addEventListener("click", async () => {
  clearHighlights();
  const result = validate();
  if (result.errors.length) {
    result.errors.forEach((rect) => eachCell(rect, (x, y) => cells[y][x].classList.add("error")));
    showMessage("数字の個数か面積が合わない四角形があります。赤い範囲を確認してください。", "error");
    return;
  }
  if (result.uncovered) {
    showMessage("まだ埋まっていないマス、または重なっている範囲があります。", "error");
    return;
  }
  finished = true;
  clearInterval(timerId);
  clearProgress();
  history.clear();
  showMessage(`クリア！ ${formatTime(elapsed)} で完成しました。`, "success");
  try {
    await saveClearRecord(currentUser?.uid || auth.currentUser?.uid || null, id, elapsed, { type: "shikaku", difficulty, size });
  } catch (error) {
    console.error("記録の保存に失敗しました", error);
    showMessage(`クリアしましたが、記録を保存できませんでした。（${error.code || "unknown"}）`, "error");
  }
});

document.getElementById("hint-btn").addEventListener("click", () => {
  clearHighlights();
  const hint = getShikakuHint(userRects, boardNumbers, solutionRects);
  if (hint.rect) eachCell(hint.rect, (x, y) => cells[y][x].classList.add(hint.tone === "error" ? "error" : "hint-area"));
  if (hint.number) cells[hint.number.y][hint.number.x].classList.add("hint-number");
  showMessage(hint.message, hint.tone === "error" ? "error" : hint.tone === "success" ? "success" : "");
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (!userRects.length && !draftEdges.size) return;
  if (!confirm("盤面への入力をすべて消しますか？")) return;
  const before = snapshot();
  userRects = [];
  draftEdges.clear();
  history.record(before);
  clearHighlights();
  render();
  persist();
  showMessage("入力を消しました。");
});

document.getElementById("answer-btn").addEventListener("click", async () => {
  if (!confirm("解答を表示すると、この問題は終了済みになります。表示しますか？")) return;
  finished = true;
  clearInterval(timerId);
  userRects = solutionRects.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
  draftEdges.clear();
  clearProgress();
  history.clear();
  render();
  board.querySelectorAll(".cell").forEach((cell) => cell.classList.add("answer"));
  showMessage("解答を表示しました。この問題は終了済みとして記録されました。");
  try {
    await markPuzzleFinished(currentUser?.uid || auth.currentUser?.uid || null, id, "answer-revealed", {
      type: "shikaku", difficulty, size, elapsedTime: elapsed,
    });
  } catch (error) {
    console.error("終了記録の保存に失敗しました", error);
    showMessage(`解答を表示しましたが、終了記録を保存できませんでした。（${error.code || "unknown"}）`, "error");
  }
});

function startClock(resumeSeconds = 0) {
  elapsed = resumeSeconds;
  startedAt = Date.now() - elapsed * 1000;
  timer.textContent = formatTime(elapsed);
  clearInterval(timerId);
  timerId = setInterval(() => {
    elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = formatTime(elapsed);
    if (elapsed % 3 === 0) persist();
  }, 1000);
}

function convertLegacyDraftCells(values) {
  if (!Array.isArray(values)) return new Set();
  const points = new Set();
  if (Array.isArray(values[0])) {
    values.forEach((row, y) => row.forEach((filledCell, x) => { if (filledCell) points.add(`${x},${y}`); }));
  } else {
    values.forEach((value) => points.add(value));
  }
  const result = new Set();
  points.forEach((value) => {
    const point = parsePoint(value);
    [{ x: point.x + 1, y: point.y }, { x: point.x, y: point.y + 1 }].forEach((neighbor) => {
      if (points.has(pointKey(neighbor))) result.add(edgeKey(point, neighbor));
    });
  });
  return result;
}

async function init() {
  if (!id) throw new Error("パズルIDが指定されていません。");
  const saved = resuming ? loadProgress() : null;
  if (saved?.type === "shikaku" && saved.id === id) {
    size = Number(saved.size) || size;
    difficulty = saved.difficulty || difficulty;
    boardNumbers = saved.boardNumbers;
    solutionRects = saved.solutionRects;
    userRects = saved.userRectangles || saved.currentRects || [];
    draftEdges = saved.draftEdges ? new Set(saved.draftEdges) : convertLegacyDraftCells(saved.draftCells);
    startClock(saved.elapsedTime || 0);
  } else {
    const puzzle = await fetchPuzzleById(id);
    if (!puzzle || puzzle.type !== "shikaku") throw new Error("指定された四角に切れの問題が見つかりません。");
    size = Number(puzzle.size) || size;
    difficulty = puzzle.difficulty || difficulty;
    boardNumbers = puzzle.problemData || puzzle.puzzleData;
    solutionRects = puzzle.solutionData || puzzle.solutionRects;
    if (!Array.isArray(boardNumbers) || !Array.isArray(solutionRects)) throw new Error("問題データの形式が正しくありません。");
    startClock();
  }
  document.getElementById("size-label").textContent = `${size} × ${size}`;
  document.getElementById("difficulty-label").textContent = difficultyNames[difficulty];
  createBoard();
  history.clear();
  persist();
}

try {
  await init();
} catch (error) {
  console.error(error);
  loading.textContent = `${error.message || "盤面の読み込みに失敗しました。"} ホームに戻って、もう一度お試しください。`;
}
