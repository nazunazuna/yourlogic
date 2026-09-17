import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, fetchPuzzleById, markPuzzleFinished, saveClearRecord } from "../../services/firebaseService.js?v=20260918-1";
import { clearProgress, loadProgress, saveProgress } from "../../core/progressStore.js?v=20260918-1";
import { bindUndoShortcut, createUndoHistory } from "../../core/historyStore.js?v=20260918-1";
import { getNumberlinkHint } from "./numberlinkHint.js?v=20260918-1";
import { normalizeNumberlinkProblem, parseNumberlinkEdge } from "./numberlinkSolver.js?v=20260918-1";

const params = new URLSearchParams(location.search);
const allowedSizes = [5, 10, 20, 30];
const difficultyNames = { easy: "初級", standard: "中級", hard: "上級", insane: "超上級" };
const defaultSizes = { easy: 5, standard: 10, hard: 20, insane: 30 };
let difficulty = ["easy", "standard", "hard", "insane"].includes(params.get("diff")) ? params.get("diff") : "standard";
const requestedSize = Number(params.get("size")) || defaultSizes[difficulty];
let size = allowedSizes.includes(requestedSize) ? requestedSize : defaultSizes[difficulty];
const id = params.get("id");
const requestedPlayMode = params.get("mode");
const playMode = ["daily", "challenge"].includes(requestedPlayMode) ? requestedPlayMode : "normal";
const isChallenge = playMode === "challenge";
const challengeSessionKey = id ? `yourlogic:challenge-session:${id}` : null;
const challengeReentry = Boolean(isChallenge && challengeSessionKey && sessionStorage.getItem(challengeSessionKey) === "active");
if (isChallenge && challengeSessionKey && !challengeReentry) sessionStorage.setItem(challengeSessionKey, "active");
const resuming = !isChallenge && params.get("resume") === "true";

const COLORS = [
  "#d84a4a", "#2f80ed", "#2ca86f", "#d28a17", "#8e5bd9", "#d9559b",
  "#168c9f", "#79543a", "#627d32", "#df6b32", "#4d63b4", "#a94773",
  "#198873", "#9a7a16", "#b44d99", "#397a9c", "#7d5bab", "#4f8739",
];

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
const cells = [];
let overlay = null;
let problemGrid = [];
let solutionData = { edges: [], owners: [] };
let endpoints = new Map();
let paths = {};
let mode = "draw";
let dragging = false;
let activeLabel = null;
let activeCell = null;
let dragBefore = null;
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
        type: "numberlink", difficulty, size, elapsedTime: 0, mode: playMode,
      });
    } catch (error) {
      console.error("再読み込み時の途中棄権記録に失敗しました", error);
    }
    sessionStorage.removeItem(challengeSessionKey);
    location.href = "../index.html";
  }
});

function colorFor(label) {
  const index = Math.max(1, Number(label)) - 1;
  if (COLORS[index]) return COLORS[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 62% 42%)`;
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

function showCompletionPanel() {
  if (!completionPanel) return;
  completionPanel.hidden = false;
  if (isChallenge) {
    completionCopy.textContent = "生成ポイントを1使って、次のランダムチャレンジに挑戦できます。";
    retryButton.textContent = "もう一度チャレンジ";
  } else {
    completionCopy.textContent = `${difficultyNames[difficulty]}・${size} × ${size}のナンバーリンクを、もう一問遊べます。`;
    retryButton.textContent = "同じ条件でもう一問";
  }
}

function guardFinished() {
  if (!finished) return false;
  showMessage(completionState === "cleared" ? "パズルはクリア済みです！" : "このパズルは終了済みです。", "success");
  return true;
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

function resetHintStage(hideVisibleHint = false) {
  const hadVisibleHint = Boolean(pendingHint || hintStage > 0);
  pendingHint = null;
  hintStage = 0;
  renderHintStage();
  if (hideVisibleHint && hadVisibleHint) showMessage("");
}

function clonePaths(source = paths) {
  return Object.fromEntries(Object.entries(source || {}).map(([label, path]) => [label, [...path]]));
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshot() {
  return { paths: clonePaths() };
}

function clearHighlights() {
  board.querySelectorAll(".hint-focus,.hint-area,.error").forEach((cell) => {
    cell.classList.remove("hint-focus", "hint-area", "error");
  });
}

function applySnapshot(saved) {
  paths = clonePaths(saved.paths || {});
  resetHintStage(true);
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
renderHintStage();

function collectEndpoints() {
  endpoints = new Map();
  problemGrid.forEach((label, cell) => {
    if (!label) return;
    if (!endpoints.has(label)) endpoints.set(label, []);
    endpoints.get(label).push(cell);
  });
}

function initialPaths() {
  return Object.fromEntries([...endpoints.entries()].map(([label, points]) => [String(label), [points[0]]]));
}

function normalizeSavedPaths(source) {
  const result = initialPaths();
  Object.entries(source || {}).forEach(([labelText, path]) => {
    const label = Number(labelText);
    if (!endpoints.has(label) || !Array.isArray(path) || !path.length) return;
    const clean = path.map(Number).filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size);
    if (!clean.length || problemGrid[clean[0]] !== label) return;
    const valid = clean.every((cell, index) => index === 0 || areAdjacent(clean[index - 1], cell));
    if (valid) result[label] = clean;
  });
  return result;
}

function areAdjacent(left, right) {
  const lx = left % size;
  const ly = Math.floor(left / size);
  const rx = right % size;
  const ry = Math.floor(right / size);
  return Math.abs(lx - rx) + Math.abs(ly - ry) === 1;
}

function pathIsComplete(label) {
  const path = paths[label] || [];
  const pair = endpoints.get(Number(label)) || [];
  if (path.length < 2 || pair.length !== 2) return false;
  return (path[0] === pair[0] && path[path.length - 1] === pair[1])
    || (path[0] === pair[1] && path[path.length - 1] === pair[0]);
}

function pathOwner(cell) {
  for (const [label, path] of Object.entries(paths)) {
    if (path.includes(cell)) return Number(label);
  }
  return null;
}

function createPolyline(path, label, className) {
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", path.map((cell) => `${cell % size + .5},${Math.floor(cell / size) + .5}`).join(" "));
  polyline.setAttribute("class", className);
  polyline.style.setProperty("--path-color", colorFor(label));
  return polyline;
}

function render() {
  if (!cells.length) return;
  cells.forEach((cell) => {
    cell.classList.remove("path-filled", "complete", "answer");
    cell.style.removeProperty("--path-color");
  });
  overlay.replaceChildren();
  Object.entries(paths).forEach(([labelText, path]) => {
    const label = Number(labelText);
    const color = colorFor(label);
    path.forEach((cell) => {
      cells[cell]?.classList.add("path-filled");
      cells[cell]?.style.setProperty("--path-color", color);
    });
    if (path.length > 1) {
      overlay.append(createPolyline(path, label, "path-underlay"));
      overlay.append(createPolyline(path, label, "path-line"));
    }
    if (pathIsComplete(label)) {
      (endpoints.get(label) || []).forEach((cell) => cells[cell]?.classList.add("complete"));
    }
  });
  problemGrid.forEach((label, cell) => {
    if (label) cells[cell].style.setProperty("--path-color", colorFor(label));
  });
}

function createBoard() {
  board.innerHTML = "";
  cells.length = 0;
  board.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${size}, minmax(0, 1fr))`;
  board.style.setProperty("--endpoint-border", size >= 20 ? "1px" : size >= 10 ? "2px" : "3px");
  board.style.minWidth = `${Math.max(0, size * 21)}px`;
  board.style.setProperty("--cell-font", `${Math.max(7, Math.min(26, 190 / size))}px`);
  for (let cell = 0; cell < size * size; cell++) {
    const element = document.createElement("div");
    element.className = "numberlink-cell";
    element.dataset.cell = String(cell);
    element.setAttribute("role", "gridcell");
    const label = problemGrid[cell];
    if (label) {
      element.classList.add("endpoint");
      element.style.setProperty("--path-color", colorFor(label));
      const number = document.createElement("span");
      number.textContent = String(label);
      element.append(number);
    }
    board.append(element);
    cells.push(element);
  }
  overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "path-overlay");
  overlay.setAttribute("viewBox", `0 0 ${size} ${size}`);
  overlay.setAttribute("aria-hidden", "true");
  board.append(overlay);
  loading.hidden = true;
  board.hidden = false;
  render();
}

function cellFromEvent(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest(".numberlink-cell");
  if (!element || !board.contains(element)) return null;
  return Number(element.dataset.cell);
}

function cellsBetween(left, right) {
  const result = [];
  let x = left % size;
  let y = Math.floor(left / size);
  const targetX = right % size;
  const targetY = Math.floor(right / size);
  while (x !== targetX || y !== targetY) {
    if (Math.abs(targetX - x) >= Math.abs(targetY - y) && x !== targetX) x += Math.sign(targetX - x);
    else if (y !== targetY) y += Math.sign(targetY - y);
    result.push(y * size + x);
  }
  return result;
}

function appendCell(next) {
  if (activeLabel === null) return false;
  const path = paths[activeLabel] || [];
  const current = path[path.length - 1];
  if (!areAdjacent(current, next)) return false;
  const existingIndex = path.indexOf(next);
  if (existingIndex >= 0) {
    paths[activeLabel] = path.slice(0, existingIndex + 1);
    activeCell = next;
    return true;
  }
  if (pathIsComplete(activeLabel)) return false;
  const endpointLabel = problemGrid[next];
  if (endpointLabel && endpointLabel !== activeLabel) return false;
  const occupiedBy = pathOwner(next);
  if (occupiedBy !== null && occupiedBy !== activeLabel) return false;
  paths[activeLabel] = [...path, next];
  activeCell = next;
  return true;
}

function beginDraw(cell) {
  let label = Number(problemGrid[cell] || 0);
  const owner = pathOwner(cell);
  if (!label && owner !== null) label = owner;
  if (!label) return false;
  dragBefore = snapshot();
  const path = paths[label] || [];
  const index = path.indexOf(cell);
  if (problemGrid[cell] === label) paths[label] = [cell];
  else if (index >= 0) paths[label] = path.slice(0, index + 1);
  else return false;
  activeLabel = label;
  activeCell = cell;
  dragging = true;
  render();
  return true;
}

function eraseAt(cell) {
  const label = pathOwner(cell);
  if (label === null) return;
  const before = snapshot();
  const path = paths[label] || [];
  const index = path.indexOf(cell);
  if (index <= 0) paths[label] = [path[0]];
  else paths[label] = path.slice(0, index);
  if (!sameState(before, snapshot())) history.record(before);
  resetHintStage(true);
  clearHighlights();
  render();
  persist();
}

board.addEventListener("pointerdown", (event) => {
  if (guardFinished()) return;
  const cell = cellFromEvent(event);
  if (cell === null) return;
  event.preventDefault();
  board.setPointerCapture?.(event.pointerId);
  resetHintStage(true);
  clearHighlights();
  if (mode === "erase") {
    eraseAt(cell);
    return;
  }
  beginDraw(cell);
});

board.addEventListener("pointermove", (event) => {
  if (!dragging || activeCell === null) return;
  const cell = cellFromEvent(event);
  if (cell === null || cell === activeCell) return;
  let changed = false;
  for (const next of cellsBetween(activeCell, cell)) {
    if (!appendCell(next)) break;
    changed = true;
  }
  if (changed) render();
});

function coveredCellCount() {
  const covered = new Set();
  Object.values(paths).forEach((path) => path.forEach((cell) => covered.add(cell)));
  return covered.size;
}

function completeDrag() {
  if (!dragging) return;
  dragging = false;
  activeLabel = null;
  activeCell = null;
  const before = dragBefore;
  dragBefore = null;
  if (before && !sameState(before, snapshot())) history.record(before);
  render();
  persist();
  if (coveredCellCount() === size * size) void checkSolution(true);
}

board.addEventListener("pointerup", completeDrag);
board.addEventListener("pointercancel", () => {
  if (dragBefore) paths = clonePaths(dragBefore.paths);
  dragging = false;
  activeLabel = null;
  activeCell = null;
  dragBefore = null;
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

function validate() {
  const seen = new Map();
  const errors = new Set();
  let incomplete = false;
  for (const [label, pair] of endpoints.entries()) {
    const path = paths[label] || [];
    if (!pathIsComplete(label)) {
      incomplete = true;
      path.forEach((cell) => errors.add(cell));
      continue;
    }
    const unique = new Set(path);
    if (unique.size !== path.length || path.some((cell, index) => index > 0 && !areAdjacent(path[index - 1], cell))) {
      path.forEach((cell) => errors.add(cell));
    }
    path.forEach((cell) => {
      if (seen.has(cell) && seen.get(cell) !== label) errors.add(cell);
      seen.set(cell, label);
      if (problemGrid[cell] && problemGrid[cell] !== label) errors.add(cell);
    });
    pair.forEach((cell) => { if (!unique.has(cell)) errors.add(cell); });
  }
  if (seen.size !== size * size) incomplete = true;
  return { valid: !incomplete && errors.size === 0, incomplete, errors: [...errors] };
}

async function checkSolution(automatic = false) {
  if (guardFinished() || checkingSolution) return;
  checkingSolution = true;
  clearHighlights();
  const result = validate();
  if (!result.valid) {
    result.errors.forEach((cell) => cells[cell]?.classList.add("error"));
    showMessage(result.errors.length
      ? `${automatic ? "盤面が埋まったため自動で確認しました。" : ""}つながっていない数字、交差、または行き止まりがあります。赤い場所を確認してください。`
      : "まだ線が通っていないマスがあります。すべてのマスを使ってください。", "error");
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
      type: "numberlink", difficulty, size, mode: playMode,
    });
  } catch (error) {
    console.error("記録の保存に失敗しました", error);
    showMessage(`クリアしましたが、記録を保存できませんでした。（${error.code || "unknown"}）`, "error");
  } finally {
    checkingSolution = false;
  }
}

document.getElementById("check-btn").addEventListener("click", () => { void checkSolution(false); });

function paintHint(hint, className) {
  (hint.cells || []).forEach(({ x, y }) => cells[y * size + x]?.classList.add(className));
}

hintButton.addEventListener("click", () => {
  if (guardFinished()) return;
  if (hintStage === 1 && pendingHint) {
    clearHighlights();
    paintHint(pendingHint, "hint-area");
    showMessage(`ヒント2／2「${pendingHint.logicName || "線の進み方"}」：${pendingHint.message}`);
    hintStage = 2;
    renderHintStage();
    return;
  }
  clearHighlights();
  pendingHint = getNumberlinkHint(problemGrid, size, paths);
  if (["error", "success"].includes(pendingHint.tone)) {
    showMessage(pendingHint.message, pendingHint.tone);
    resetHintStage();
    return;
  }
  paintHint({ cells: pendingHint.focusCells }, "hint-focus");
  showMessage(`ヒント1／2：${pendingHint.focusMessage}`);
  hintStage = 1;
  renderHintStage();
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (guardFinished()) return;
  if (Object.values(paths).every((path) => path.length <= 1)) return;
  if (!confirm("盤面への入力をすべて消しますか？")) return;
  const before = snapshot();
  paths = initialPaths();
  history.record(before);
  resetHintStage(true);
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
    : `../index.html?auto=numberlink&diff=${encodeURIComponent(difficulty)}&size=${encodeURIComponent(size)}`;
});

function pathsFromSolution() {
  const selected = new Set(solutionData.edges || []);
  const neighbors = Array.from({ length: size * size }, () => []);
  selected.forEach((value) => {
    const [left, right] = parseNumberlinkEdge(value);
    neighbors[left]?.push(right);
    neighbors[right]?.push(left);
  });
  const result = {};
  endpoints.forEach((pair, label) => {
    const path = [pair[0]];
    let previous = -1;
    let current = pair[0];
    while (current !== pair[1] && path.length <= size * size) {
      const next = (neighbors[current] || []).find((cell) => cell !== previous);
      if (next === undefined) break;
      path.push(next);
      previous = current;
      current = next;
    }
    result[label] = path;
  });
  return result;
}

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
      type: "numberlink", difficulty, size, elapsedTime: elapsed, mode: playMode,
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
  paths = pathsFromSolution();
  clearProgress();
  history.clear();
  render();
  cells.forEach((cell) => cell.classList.add("answer"));
  showMessage("解答を表示しました。この問題は終了済みとして記録されました。");
  try {
    await markPuzzleFinished(currentUser?.uid || auth.currentUser?.uid || null, id, "answer-revealed", {
      type: "numberlink", difficulty, size, elapsedTime: elapsed, mode: playMode,
    });
  } catch (error) {
    console.error("終了記録の保存に失敗しました", error);
    showMessage(`解答を表示しましたが、終了記録を保存できませんでした。（${error.code || "unknown"}）`, "error");
  }
});

function persist() {
  if (isChallenge || finished || !id || !problemGrid.length) return;
  saveProgress({
    type: "numberlink",
    mode: playMode,
    id,
    size,
    difficulty,
    elapsedTime: elapsed,
    problemData: problemGrid,
    solutionData,
    paths: clonePaths(),
  });
}

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

function normalizeSolution(source) {
  const edges = Array.isArray(source?.edges) ? source.edges.map(String) : [];
  const owners = Array.isArray(source?.owners) ? source.owners.map(Number) : [];
  return { edges, owners };
}

async function init() {
  if (!id) throw new Error("パズルIDが指定されていません。");
  if (completionPanel) completionPanel.hidden = true;
  if (isChallenge) clearProgress();
  const saved = resuming ? loadProgress() : null;
  if (saved?.type === "numberlink" && saved.id === id) {
    size = Number(saved.size) || size;
    difficulty = saved.difficulty || difficulty;
    const normalized = normalizeNumberlinkProblem(saved.problemData, size);
    if (!normalized.size) throw new Error("保存された盤面データの形式が正しくありません。");
    size = normalized.size;
    problemGrid = normalized.grid;
    solutionData = normalizeSolution(saved.solutionData);
    collectEndpoints();
    paths = normalizeSavedPaths(saved.paths);
    startClock(saved.elapsedTime || 0);
  } else {
    const puzzle = await fetchPuzzleById(id);
    if (!puzzle || puzzle.type !== "numberlink") throw new Error("指定されたナンバーリンクの問題が見つかりません。");
    difficulty = puzzle.difficulty || difficulty;
    const normalized = normalizeNumberlinkProblem(puzzle.problemData ?? puzzle.puzzleData, puzzle.size || size);
    if (!normalized.size) throw new Error("問題データの形式が正しくありません。");
    size = normalized.size;
    problemGrid = normalized.grid;
    solutionData = normalizeSolution(puzzle.solutionData);
    if (!solutionData.edges.length) throw new Error("解答データの形式が正しくありません。");
    collectEndpoints();
    paths = initialPaths();
    startClock();
  }
  if ([...endpoints.values()].some((pair) => pair.length !== 2)) throw new Error("同じ数字の端点が2つずつありません。");
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
