import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, fetchPuzzleById, markPuzzleFinished, saveClearRecord } from "../../services/firebaseService.js?v=20260917-3";
import { clearProgress, loadProgress, saveProgress } from "../../core/progressStore.js?v=20260917-3";
import { bindUndoShortcut, createUndoHistory } from "../../core/historyStore.js?v=20260917-3";
import { completeForcedShikakuRectangles, getShikakuHint } from "./shikakuHint.js?v=20260917-3";

const params = new URLSearchParams(location.search);
const allowedSizes = [5, 10, 15, 20, 25, 30, 40, 50];
const requestedSize = Number(params.get("size")) || 10;
let size = allowedSizes.includes(requestedSize) ? requestedSize : 10;
let difficulty = ["easy", "standard", "hard", "insane"].includes(params.get("diff")) ? params.get("diff") : "standard";
const id = params.get("id");
const requestedPlayMode = params.get("mode");
const playMode = ["daily", "challenge"].includes(requestedPlayMode) ? requestedPlayMode : "normal";
const isChallenge = playMode === "challenge";
const challengeSessionKey = id ? `yourlogic:challenge-session:${id}` : null;
const challengeReentry = Boolean(isChallenge && challengeSessionKey && sessionStorage.getItem(challengeSessionKey) === "active");
if (isChallenge && challengeSessionKey && !challengeReentry) sessionStorage.setItem(challengeSessionKey, "active");
const resuming = !isChallenge && params.get("resume") === "true";
const difficultyNames = { easy: "初級", standard: "中級", hard: "上級", insane: "超上級" };

const board = document.getElementById("board");
const loading = document.getElementById("loading");
const message = document.getElementById("message");
const timer = document.getElementById("timer");
const undoButton = document.getElementById("undo-btn");
const hintButton = document.getElementById("hint-btn");
const hintStepFocus = document.getElementById("hint-step-focus");
const hintStepLogic = document.getElementById("hint-step-logic");
const completionPanel = document.getElementById("completion-panel");
const completionCopy = document.getElementById("completion-copy");
const retryButton = document.getElementById("retry-btn");
const rulesDialog = document.getElementById("rules-dialog");
const areaTooltip = document.getElementById("area-tooltip");
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
let completionState = null;
let checkingSolution = false;
let currentUser = null;
let pendingHint = null;
let hintStage = 0;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (isChallenge && !user && !finished) {
    finished = true;
    completionState = "login-required";
    if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
    showMessage("チャレンジゲームを続けるにはログインが必要です。ホームに戻ります。", "error");
    setTimeout(() => { location.href = "../index.html"; }, 1200);
    return;
  }
  if (isChallenge && user && challengeReentry) {
    finished = true;
    completionState = "abandoned";
    showMessage("再読み込みされたチャレンジを途中棄権として記録しています…", "error");
    try {
      await markPuzzleFinished(user.uid, id, "abandoned", {
        type: "shikaku", difficulty, size, elapsedTime: 0, mode: playMode,
      });
    } catch (error) {
      console.error("再読み込み時の途中棄権記録に失敗しました", error);
    }
    sessionStorage.removeItem(challengeSessionKey);
    location.href = "../index.html";
  }
});

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
function rectArea(rect) {
  return (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
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

function renderHintStage() {
  hintStepFocus?.classList.toggle("active", hintStage === 0);
  hintStepFocus?.classList.toggle("done", hintStage >= 1);
  hintStepLogic?.classList.toggle("active", hintStage === 1);
  hintStepLogic?.classList.toggle("done", hintStage >= 2);
  if (!hintButton) return;
  hintButton.textContent = hintStage === 1
    ? "ヒント2：ロジックと答えを見る"
    : hintStage === 2
      ? "次のヒント1：着目箇所を見る"
      : "ヒント1：着目箇所を見る";
}

function resetHintStage() {
  pendingHint = null;
  hintStage = 0;
  renderHintStage();
}

function showCompletionPanel() {
  if (!completionPanel) return;
  completionPanel.hidden = false;
  if (isChallenge) {
    completionCopy.textContent = "生成ポイントを1使って、次のランダムチャレンジに挑戦できます。";
    retryButton.textContent = "もう一度チャレンジ";
  } else {
    completionCopy.textContent = `${difficultyNames[difficulty]}・${size} × ${size}の四角に切れを、もう一問遊べます。`;
    retryButton.textContent = "同じ条件でもう一問";
  }
}

renderHintStage();

function guardFinished() {
  if (!finished) return false;
  showMessage(completionState === "cleared" ? "パズルはクリア済みです！" : "このパズルは終了済みです。", "success");
  return true;
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
  resetHintStage();
  clearHighlights();
  render();
  persist();
}

const history = createUndoHistory({
  apply: applySnapshot,
  onChange: ({ canUndo }) => { undoButton.disabled = !canUndo || finished; },
});
function undo() {
  if (guardFinished()) return;
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
  board.querySelectorAll(".preview-top,.preview-right,.preview-bottom,.preview-left,.hint-focus,.hint-area,.hint-number,.error").forEach((cell) => {
    cell.classList.remove("preview-top", "preview-right", "preview-bottom", "preview-left", "hint-focus", "hint-area", "hint-number", "error");
  });
}

function render() {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      cells[y][x].classList.remove("preview-top", "preview-right", "preview-bottom", "preview-left", "b-top", "b-right", "b-bottom", "b-left", "answer", "clue-complete");
    }
  }
  userRects.forEach((rect) => eachCell(rect, (x, y) => {
    if (y === rect.y1) cells[y][x].classList.add("b-top");
    if (x === rect.x2) cells[y][x].classList.add("b-right");
    if (y === rect.y2) cells[y][x].classList.add("b-bottom");
    if (x === rect.x1) cells[y][x].classList.add("b-left");
  }));
  userRects.forEach((rect) => {
    const clues = [];
    eachCell(rect, (x, y) => { if (Number(boardNumbers[y][x]) > 0) clues.push({ x, y, value: Number(boardNumbers[y][x]) }); });
    const rectArea = (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
    if (clues.length === 1 && clues[0].value === rectArea) cells[clues[0].y][clues[0].x].classList.add("clue-complete");
  });
  renderDraftLines();
}

function previewRect(rect) {
  board.querySelectorAll(".preview-top,.preview-right,.preview-bottom,.preview-left").forEach((cell) => {
    cell.classList.remove("preview-top", "preview-right", "preview-bottom", "preview-left");
  });
  eachCell(rect, (x, y) => {
    if (y === rect.y1) cells[y][x].classList.add("preview-top");
    if (x === rect.x2) cells[y][x].classList.add("preview-right");
    if (y === rect.y2) cells[y][x].classList.add("preview-bottom");
    if (x === rect.x1) cells[y][x].classList.add("preview-left");
  });
}

function showAreaTooltip(rect, event) {
  if (!areaTooltip || mode !== "draw") return;
  areaTooltip.textContent = `${rectArea(rect)}マス`;
  areaTooltip.style.left = `${event.clientX}px`;
  areaTooltip.style.top = `${event.clientY}px`;
  areaTooltip.hidden = false;
}

function hideAreaTooltip() {
  if (areaTooltip) areaTooltip.hidden = true;
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
  if (guardFinished()) return;
  const coord = cellFromEvent(event);
  if (!coord) return;
  event.preventDefault();
  board.setPointerCapture?.(event.pointerId);
  resetHintStage();
  clearHighlights();
  dragStart = coord;
  dragEnd = coord;
  dragPath = [coord];
  if (mode === "draft") renderDraftLines(dragPath);
  else {
    const rect = normalizedRect(dragStart, dragEnd);
    previewRect(rect);
    showAreaTooltip(rect, event);
  }
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
    const rect = normalizedRect(dragStart, coord);
    previewRect(rect);
    showAreaTooltip(rect, event);
  }
  dragEnd = coord;
});

function completeDrag() {
  if (!dragStart || !dragEnd) return;
  const before = snapshot();
  const rect = normalizedRect(dragStart, dragEnd);
  let autoCompleted = 0;
  hideAreaTooltip();
  board.querySelectorAll(".preview-top,.preview-right,.preview-bottom,.preview-left").forEach((cell) => {
    cell.classList.remove("preview-top", "preview-right", "preview-bottom", "preview-left");
  });

  if (mode === "draw") {
    userRects = userRects.filter((existing) => !overlaps(existing, rect));
    userRects.push(rect);
    draftEdges = new Set([...draftEdges].filter((value) => {
      const [a, b] = parseEdge(value);
      return !(inside(a, rect) && inside(b, rect));
    }));
    autoCompleted = completeForcedRectangles();
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
  if (mode === "draw") {
    const result = validate();
    if (!result.uncovered) void checkSolution(true);
    else if (autoCompleted > 0) showMessage(`ルールから一意に決まる四角形を ${autoCompleted} 個、自動で補いました。`);
  }
}

board.addEventListener("pointerup", completeDrag);
board.addEventListener("pointercancel", () => {
  dragStart = dragEnd = null;
  dragPath = [];
  hideAreaTooltip();
  render();
});

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => {
  if (guardFinished()) return;
  mode = button.dataset.mode;
  document.querySelectorAll(".mode").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}));

function persist() {
  if (isChallenge || finished || !id || !boardNumbers.length) return;
  saveProgress({
    type: "shikaku",
    mode: playMode,
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

// 入力済みの枠を避けると候補が1つしか残らない数字を、自動で枠として確定します。
// 保存済みの正解は参照せず、盤面に表示されている数字とルールだけで判定します。
function completeForcedRectangles() {
  const previousCount = userRects.length;
  const result = completeForcedShikakuRectangles(boardNumbers, userRects);
  if (result.error || result.added === 0) return 0;
  userRects = result.rectangles;
  result.rectangles.slice(previousCount).forEach((rect) => {
    draftEdges = new Set([...draftEdges].filter((value) => {
      const [a, b] = parseEdge(value);
      return !(inside(a, rect) && inside(b, rect));
    }));
  });
  return result.added;
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

async function checkSolution(automatic = false) {
  if (guardFinished() || checkingSolution) return;
  checkingSolution = true;
  clearHighlights();
  const result = validate();
  if (result.errors.length) {
    result.errors.forEach((rect) => eachCell(rect, (x, y) => cells[y][x].classList.add("error")));
    showMessage(`${automatic ? "盤面が埋まったため自動で確認しました。" : ""}数字の個数か面積が合わない四角形があります。赤い範囲を確認してください。`, "error");
    checkingSolution = false;
    return;
  }
  if (result.uncovered) {
    showMessage("まだ埋まっていないマス、または重なっている範囲があります。", "error");
    checkingSolution = false;
    return;
  }
  finished = true;
  completionState = "cleared";
  if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
  clearInterval(timerId);
  clearProgress();
  history.clear();
  showMessage(`クリア！ ${formatTime(elapsed)} で完成しました。`, "success");
  showCompletionPanel();
  try {
    await saveClearRecord(currentUser?.uid || auth.currentUser?.uid || null, id, elapsed, {
      type: "shikaku", difficulty, size, mode: playMode,
    });
  } catch (error) {
    console.error("記録の保存に失敗しました", error);
    showMessage(`クリアしましたが、記録を保存できませんでした。（${error.code || "unknown"}）`, "error");
  } finally {
    checkingSolution = false;
  }
}

document.getElementById("check-btn").addEventListener("click", () => { void checkSolution(false); });

function paintFullHint(hint) {
  if (hint.rect) eachCell(hint.rect, (x, y) => cells[y][x].classList.add(hint.tone === "error" ? "error" : "hint-area"));
  if (hint.cells) hint.cells.forEach(({ x, y }) => cells[y]?.[x]?.classList.add(hint.tone === "error" ? "error" : "hint-area"));
  if (hint.number) cells[hint.number.y]?.[hint.number.x]?.classList.add(hint.tone === "error" ? "error" : "hint-number");
}

hintButton.addEventListener("click", () => {
  if (guardFinished()) return;

  if (hintStage === 1 && pendingHint) {
    clearHighlights();
    paintFullHint(pendingHint);
    showMessage(`ヒント2／2「${pendingHint.logicName || "盤面の絞り込み"}」：${pendingHint.message}`);
    hintStage = 2;
    renderHintStage();
    return;
  }

  clearHighlights();
  pendingHint = getShikakuHint(userRects, boardNumbers);
  if (["error", "success"].includes(pendingHint.tone)) {
    paintFullHint(pendingHint);
    showMessage(pendingHint.message, pendingHint.tone);
    resetHintStage();
    return;
  }

  (pendingHint.focusCells || (pendingHint.number ? [pendingHint.number] : []))
    .forEach(({ x, y }) => cells[y]?.[x]?.classList.add("hint-focus"));
  showMessage(`ヒント1／2：${pendingHint.focusMessage || "ハイライトした場所に注目してください。"}`);
  hintStage = 1;
  renderHintStage();
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (guardFinished()) return;
  if (!userRects.length && !draftEdges.size) return;
  if (!confirm("盤面への入力をすべて消しますか？")) return;
  const before = snapshot();
  userRects = [];
  draftEdges.clear();
  history.record(before);
  resetHintStage();
  clearHighlights();
  render();
  persist();
  showMessage("入力を消しました。");
});

document.getElementById("rules-btn").addEventListener("click", () => {
  if (typeof rulesDialog?.showModal === "function") rulesDialog.showModal();
});

retryButton?.addEventListener("click", () => {
  location.href = isChallenge
    ? "../index.html?auto=challenge"
    : `../index.html?auto=shikaku&diff=${encodeURIComponent(difficulty)}&size=${encodeURIComponent(size)}`;
});

async function forfeitChallenge(destination = "../index.html") {
  if (finished) {
    location.href = destination;
    return;
  }
  if (!confirm("チャレンジを途中棄権しますか？\nこのプレイは終了済みとして記録され、続きから再開できません。")) return;
  finished = true;
  completionState = "abandoned";
  if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
  clearInterval(timerId);
  clearProgress();
  history.clear();
  showMessage("チャレンジを途中棄権として記録しています…");
  try {
    await markPuzzleFinished(currentUser?.uid || auth.currentUser?.uid || null, id, "abandoned", {
      type: "shikaku", difficulty, size, elapsedTime: elapsed, mode: playMode,
    });
  } catch (error) {
    console.error("途中棄権の記録に失敗しました", error);
  }
  location.href = destination;
}

document.getElementById("answer-btn").addEventListener("click", async () => {
  if (guardFinished()) return;
  if (isChallenge) {
    await forfeitChallenge();
    return;
  }
  if (!confirm("解答を表示すると、この問題は終了済みになります。表示しますか？")) return;
  finished = true;
  completionState = "answer-revealed";
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
      type: "shikaku", difficulty, size, elapsedTime: elapsed, mode: playMode,
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
  if (completionPanel) completionPanel.hidden = true;
  if (isChallenge) clearProgress();
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
  const modeLabel = document.getElementById("play-mode-label");
  if (playMode === "daily") {
    modeLabel.hidden = false;
    modeLabel.textContent = "今日のおすすめ";
  } else if (isChallenge) {
    modeLabel.hidden = false;
    modeLabel.textContent = "チャレンジ・途中保存なし";
    document.getElementById("answer-btn").textContent = "途中棄権する";
  }
  createBoard();
  history.clear();
  persist();
}

document.querySelectorAll("a[href]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!isChallenge || finished) return;
    event.preventDefault();
    void forfeitChallenge(link.href);
  });
});

window.addEventListener("beforeunload", (event) => {
  if (!isChallenge || finished) return;
  event.preventDefault();
  event.returnValue = "";
});

try {
  await init();
} catch (error) {
  console.error(error);
  loading.textContent = `${error.message || "盤面の読み込みに失敗しました。"} ホームに戻って、もう一度お試しください。`;
}
