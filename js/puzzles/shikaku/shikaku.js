import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, saveClearRecord } from "../../services/firebaseService.js";
import { clearProgress, loadProgress, saveProgress } from "../../core/progressStore.js";
import { generateShikakuPuzzle } from "./shikakuGenerator.js";
import { getShikakuHint } from "./shikakuHint.js";

const params = new URLSearchParams(location.search);
const allowedSizes = [5, 10, 15, 20, 25, 30, 40, 50];
const requestedSize = Number(params.get("size")) || 10;
const size = allowedSizes.includes(requestedSize) ? requestedSize : 10;
const difficulty = ["easy", "standard", "hard", "insane"].includes(params.get("diff")) ? params.get("diff") : "standard";
const id = params.get("id") || `shikaku-${Date.now()}`;
const resuming = params.get("resume") === "true";
const difficultyNames = { easy: "初級", standard: "中級", hard: "上級", insane: "超上級" };

const board = document.getElementById("board");
const loading = document.getElementById("loading");
const message = document.getElementById("message");
const timer = document.getElementById("timer");
const cells = [];
let currentUser = null;
let boardNumbers = [];
let solutionRects = [];
let userRects = [];
let draft = new Set();
let mode = "draw";
let dragStart = null;
let dragEnd = null;
let elapsed = 0;
let startedAt = Date.now();
let timerId = null;
let finished = false;

onAuthStateChanged(auth, (user) => { currentUser = user; });

function key(x, y) { return `${x},${y}`; }
function normalizedRect(a, b) {
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
}
function overlaps(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}
function eachCell(rect, callback) {
  for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) callback(x, y);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function showMessage(text, tone = "") {
  message.textContent = text;
  message.className = `notice ${tone === "hint" ? "" : tone}`.trim();
  message.hidden = !text;
}

function createBoard() {
  board.innerHTML = "";
  cells.length = 0;
  board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
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
      cells[y][x].classList.remove("draft", "preview", "b-top", "b-right", "b-bottom", "b-left", "answer");
      if (draft.has(key(x, y))) cells[y][x].classList.add("draft");
    }
  }
  userRects.forEach((rect) => eachCell(rect, (x, y) => {
    if (y === rect.y1) cells[y][x].classList.add("b-top");
    if (x === rect.x2) cells[y][x].classList.add("b-right");
    if (y === rect.y2) cells[y][x].classList.add("b-bottom");
    if (x === rect.x1) cells[y][x].classList.add("b-left");
  }));
}

function preview(rect) {
  board.querySelectorAll(".preview").forEach((cell) => cell.classList.remove("preview"));
  eachCell(rect, (x, y) => cells[y][x].classList.add("preview"));
}

function cellFromEvent(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
  if (!element || !board.contains(element)) return null;
  return { x: Number(element.dataset.x), y: Number(element.dataset.y) };
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
  preview(normalizedRect(dragStart, dragEnd));
});

board.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  const coord = cellFromEvent(event);
  if (!coord || (coord.x === dragEnd.x && coord.y === dragEnd.y)) return;
  dragEnd = coord;
  preview(normalizedRect(dragStart, dragEnd));
});

function completeDrag() {
  if (!dragStart || !dragEnd) return;
  const rect = normalizedRect(dragStart, dragEnd);
  dragStart = dragEnd = null;
  board.querySelectorAll(".preview").forEach((cell) => cell.classList.remove("preview"));

  if (mode === "draw") {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    userRects.push(rect);
    eachCell(rect, (x, y) => draft.delete(key(x, y)));
  } else if (mode === "draft") {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    const shouldFill = !draft.has(key(rect.x1, rect.y1));
    eachCell(rect, (x, y) => shouldFill ? draft.add(key(x, y)) : draft.delete(key(x, y)));
  } else {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    eachCell(rect, (x, y) => draft.delete(key(x, y)));
  }
  render();
  persist();
}

board.addEventListener("pointerup", completeDrag);
board.addEventListener("pointercancel", () => { dragStart = dragEnd = null; render(); });

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  document.querySelectorAll(".mode").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}));

function persist() {
  if (finished || !boardNumbers.length) return;
  saveProgress({
    type: "shikaku", id, size, difficulty, elapsedTime: elapsed,
    boardNumbers, solutionRects, userRectangles: userRects, draftCells: [...draft],
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
    const area = (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
    if (numbers.length !== 1 || numbers[0] !== area) errors.push(rect);
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
  showMessage(`クリア！ ${formatTime(elapsed)} で完成しました。`, "success");
  try {
    await saveClearRecord(currentUser?.uid || null, id, elapsed, { type: "shikaku", difficulty, size });
  } catch (error) { console.error("記録の保存に失敗しました", error); }
});

document.getElementById("hint-btn").addEventListener("click", () => {
  clearHighlights();
  const hint = getShikakuHint(userRects, boardNumbers, solutionRects);
  if (hint.rect) eachCell(hint.rect, (x, y) => cells[y][x].classList.add(hint.tone === "error" ? "error" : "hint-area"));
  if (hint.number) cells[hint.number.y][hint.number.x].classList.add("hint-number");
  showMessage(hint.message, hint.tone === "error" ? "error" : hint.tone === "success" ? "success" : "");
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (!userRects.length && !draft.size) return;
  if (!confirm("盤面への入力をすべて消しますか？")) return;
  userRects = [];
  draft.clear();
  clearHighlights();
  render();
  persist();
  showMessage("入力を消しました。");
});

document.getElementById("answer-btn").addEventListener("click", () => {
  if (!confirm("解答を表示すると、この問題の記録は残りません。表示しますか？")) return;
  finished = true;
  clearInterval(timerId);
  userRects = solutionRects.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
  draft.clear();
  clearProgress();
  render();
  board.querySelectorAll(".cell").forEach((cell) => cell.classList.add("answer"));
  showMessage("解答を表示しました。ホームから新しい問題を選べます。");
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

function init() {
  document.getElementById("size-label").textContent = `${size} × ${size}`;
  document.getElementById("difficulty-label").textContent = difficultyNames[difficulty];
  const saved = resuming ? loadProgress() : null;
  if (saved?.type === "shikaku") {
    boardNumbers = saved.boardNumbers;
    solutionRects = saved.solutionRects;
    userRects = saved.userRectangles || saved.currentRects || [];
    if (Array.isArray(saved.draftCells?.[0])) {
      draft = new Set();
      saved.draftCells.forEach((row, y) => row.forEach((filled, x) => { if (filled) draft.add(key(x, y)); }));
    } else {
      draft = new Set(saved.draftCells || []);
    }
    startClock(saved.elapsedTime || 0);
  } else {
    const generated = generateShikakuPuzzle(size, difficulty);
    boardNumbers = generated.puzzleData;
    solutionRects = generated.solutionRects;
    startClock();
  }
  createBoard();
  persist();
}

try { init(); }
catch (error) {
  console.error(error);
  loading.textContent = "盤面の生成に失敗しました。ホームに戻って、もう一度お試しください。";
}
