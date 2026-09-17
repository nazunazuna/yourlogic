import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  auth, db, provider, cacheDailyPuzzle, calculateGenerationPoints, checkUserExists,
  calculateDailyStats, createGeneratedPuzzle, fetchOrInitUser, fetchPuzzles, getCachedDailyPuzzle,
  getGuestDailyStats,
  getGuestFinishedPuzzleIds, getJstDateKey, markPuzzleFinished, syncGenerationPoints,
  MAX_GENERATION_POINTS,
} from "./services/firebaseService.js?v=20260917-5";
import { generatePuzzle } from "./puzzles/sudoku/sudokuGenerator.js?v=20260917-3";
import { generateShikakuPuzzle } from "./puzzles/shikaku/shikakuGenerator.js?v=20260917-3";
import { generateNumberlinkPuzzle, numberlinkSizeForDifficulty } from "./puzzles/numberlink/numberlinkGenerator.js?v=20260917-5";
import { clearProgress, loadProgress, progressLabel, progressUrl } from "./core/progressStore.js?v=20260917-5";
import { filterAndSortPuzzles, getPuzzleGenre, PUZZLE_GENRES } from "./core/puzzleCatalog.js?v=20260917-4";

const DIFFICULTIES = ["easy", "standard", "hard", "insane"];
const DIFFICULTY_NAMES = { easy: "初級", standard: "中級", hard: "上級", insane: "超上級" };
const PUZZLE_TYPES = ["sudoku", "shikaku", "numberlink"];
const PUZZLE_NAMES = { sudoku: "数独", shikaku: "四角に切れ", numberlink: "ナンバーリンク" };
const PUZZLE_ICONS = { sudoku: "09", shikaku: "▣", numberlink: "⌁" };
const SHIKAKU_SIZES = {
  easy: [5, 10],
  standard: [10, 15, 20, 25, 30],
  hard: [20, 25, 30, 40],
  insane: [30, 40, 50],
};
const SHIKAKU_GENERATOR_VERSION = "logic-v4";
const NUMBERLINK_GENERATOR_VERSION = "edge-csp-v1";
const DAILY_ALGORITHM_VERSION = "daily-v3";

const state = {
  user: null,
  userData: null,
  sudokuDifficulty: "easy",
  shikakuDifficulty: "easy",
  numberlinkDifficulty: "easy",
  busy: false,
  authReady: false,
  syncingPoints: false,
  dailyPuzzle: null,
  dailyReady: false,
  dailyFinished: false,
};
let staminaInterval = null;
let dailyRefreshInterval = null;

const $ = (selector) => document.querySelector(selector);
const loginBtn = $("#login-btn");
const logoutBtn = $("#logout-btn");
const userActions = $("#user-actions");
const userName = $("#user-name");
const status = $("#home-status");
const sudokuBtn = $("#start-sudoku-btn");
const shikakuBtn = $("#start-shikaku-btn");
const numberlinkBtn = $("#start-numberlink-btn");
const dailyBtn = $("#daily-btn");
const challengeBtn = $("#challenge-btn");
const sizeSelect = $("#shikaku-size");
const stockDialog = $("#stock-dialog");
const puzzleGrid = $("#puzzle-grid");
const puzzleSearch = $("#puzzle-search");
const puzzleGenreFilter = $("#puzzle-genre-filter");
const puzzleSort = $("#puzzle-sort");
const puzzleResultCount = $("#puzzle-result-count");
const puzzleEmpty = $("#puzzle-empty");
const genreTooltip = $("#genre-tooltip");

const puzzleCatalog = [...document.querySelectorAll("[data-puzzle-card]")].map((card, index) => ({
  id: card.dataset.puzzleId,
  name: card.dataset.puzzleName,
  subtitle: card.querySelector(".card-title-row p")?.textContent || "",
  description: card.querySelector(".card-description")?.textContent || "",
  genres: String(card.dataset.genres || "other").split(",").map((value) => value.trim()).filter(Boolean),
  order: Number(card.dataset.order || index + 1),
  card,
}));

function hideGenreTooltip() {
  if (genreTooltip) genreTooltip.hidden = true;
}

function showGenreTooltip(tag, description) {
  if (!genreTooltip || !description) return;
  genreTooltip.textContent = description;
  genreTooltip.hidden = false;
  const tagRect = tag.getBoundingClientRect();
  const tooltipRect = genreTooltip.getBoundingClientRect();
  const left = Math.min(
    innerWidth - tooltipRect.width - 12,
    Math.max(12, tagRect.left + (tagRect.width - tooltipRect.width) / 2),
  );
  let top = tagRect.top - tooltipRect.height - 9;
  if (top < 8) top = tagRect.bottom + 9;
  genreTooltip.style.left = `${left}px`;
  genreTooltip.style.top = `${top}px`;
}

function renderPuzzleTags() {
  puzzleCatalog.forEach((puzzle) => {
    const container = puzzle.card.querySelector(".puzzle-tags");
    if (!container) return;
    const tags = puzzle.genres.map((id) => {
      const genre = getPuzzleGenre(id);
      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = "puzzle-tag";
      tag.textContent = genre.label;
      tag.dataset.genre = genre.id;
      if (genre.description) {
        tag.setAttribute("aria-label", `${genre.label}：${genre.description}`);
        tag.addEventListener("pointerenter", () => showGenreTooltip(tag, genre.description));
        tag.addEventListener("pointerleave", hideGenreTooltip);
        tag.addEventListener("focus", () => showGenreTooltip(tag, genre.description));
        tag.addEventListener("blur", hideGenreTooltip);
      }
      tag.addEventListener("click", () => {
        puzzleGenreFilter.value = genre.id;
        applyPuzzleBrowser();
      });
      return tag;
    });
    container.replaceChildren(...tags);
  });
}

function applyPuzzleBrowser() {
  hideGenreTooltip();
  const matches = filterAndSortPuzzles(puzzleCatalog, {
    query: puzzleSearch.value,
    genre: puzzleGenreFilter.value,
    sort: puzzleSort.value,
  });
  const visibleIds = new Set(matches.map((puzzle) => puzzle.id));
  puzzleCatalog.forEach((puzzle) => { puzzle.card.hidden = !visibleIds.has(puzzle.id); });
  matches.forEach((puzzle) => puzzleGrid.append(puzzle.card));
  puzzleGrid.hidden = matches.length === 0;
  puzzleEmpty.hidden = matches.length !== 0;
  puzzleResultCount.textContent = `${matches.length}件のパズル`;
}

function resetPuzzleBrowser() {
  puzzleSearch.value = "";
  puzzleGenreFilter.value = "all";
  puzzleSort.value = "default";
  applyPuzzleBrowser();
  puzzleSearch.focus();
}

PUZZLE_GENRES.forEach((genre) => {
  const option = document.createElement("option");
  option.value = genre.id;
  option.textContent = genre.label;
  if (genre.description) option.title = genre.description;
  puzzleGenreFilter.append(option);
});
renderPuzzleTags();
puzzleSearch.addEventListener("input", applyPuzzleBrowser);
puzzleGenreFilter.addEventListener("change", applyPuzzleBrowser);
puzzleSort.addEventListener("change", applyPuzzleBrowser);
$("#puzzle-filter-reset").addEventListener("click", resetPuzzleBrowser);
$("#puzzle-empty-reset").addEventListener("click", resetPuzzleBrowser);
window.addEventListener("scroll", hideGenreTooltip, { passive: true });
window.addEventListener("resize", hideGenreTooltip);
applyPuzzleBrowser();

function showStatus(message, tone = "") {
  status.textContent = message;
  status.className = `notice shell ${tone}`.trim();
  status.hidden = !message;
}

function setBusy(busy) {
  state.busy = busy;
  [sudokuBtn, shikakuBtn, numberlinkBtn, challengeBtn].forEach((button) => {
    if (button) button.disabled = busy || !state.authReady;
  });
  if (dailyBtn) dailyBtn.disabled = busy || !state.dailyReady || state.dailyFinished;
}

function renderProgress() {
  const progress = loadProgress();
  $("#resume-panel").hidden = !progress;
  if (progress) $("#resume-label").textContent = progressLabel(progress);
}

function renderShikakuSizes() {
  const allowed = SHIKAKU_SIZES[state.shikakuDifficulty];
  const previous = Number(sizeSelect.value);
  sizeSelect.replaceChildren(...allowed.map((size) => {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = `${size} × ${size}`;
    return option;
  }));
  sizeSelect.value = String(allowed.includes(previous) ? previous : allowed[0]);
}

function choose(group, button) {
  group.querySelectorAll(".choice").forEach((item) => {
    const selected = item === button;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
  if (group.dataset.choiceGroup === "sudoku") {
    state.sudokuDifficulty = button.dataset.value;
  } else if (group.dataset.choiceGroup === "shikaku") {
    state.shikakuDifficulty = button.dataset.value;
    renderShikakuSizes();
  } else if (group.dataset.choiceGroup === "numberlink") {
    state.numberlinkDifficulty = button.dataset.value;
  }
}

document.querySelectorAll("[data-choice-group]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest(".choice");
    if (button) choose(group, button);
  });
});

function renderStamina() {
  const box = $("#stamina");
  const challengePoints = $("#challenge-points");
  if (!state.user || !state.userData) {
    box.hidden = true;
    if (challengePoints) challengePoints.textContent = "ログインすると挑戦できます";
    return;
  }
  const { points, nextPointAtMs } = calculateGenerationPoints(state.userData);
  if (challengePoints) challengePoints.textContent = `生成ポイント ${points} / ${MAX_GENERATION_POINTS}`;
  if (points !== Number(state.userData.generationPoints ?? MAX_GENERATION_POINTS) && !state.syncingPoints) {
    state.syncingPoints = true;
    syncGenerationPoints(state.user.uid)
      .catch((error) => console.error("生成ポイントの回復保存に失敗しました", error))
      .finally(() => { state.syncingPoints = false; });
  }
  box.hidden = false;
  $("#stamina-count").textContent = `${points} / ${MAX_GENERATION_POINTS}`;
  if (!nextPointAtMs) {
    $("#stamina-timer").textContent = "";
    return;
  }
  const seconds = Math.max(0, Math.ceil((nextPointAtMs - Date.now()) / 1000));
  $("#stamina-timer").textContent = `次まで ${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function beginStaminaClock() {
  clearInterval(staminaInterval);
  renderStamina();
  staminaInterval = setInterval(renderStamina, 1000);
}

function progressMetadata(progress) {
  return {
    type: progress.type,
    difficulty: progress.difficulty,
    size: progress.type === "sudoku" ? 9 : progress.size,
    elapsedTime: progress.elapsedTime || 0,
    mode: progress.mode || "normal",
  };
}

async function abandonProgress(progress) {
  await markPuzzleFinished(state.user?.uid || null, progress.id, "abandoned", progressMetadata(progress));
  clearProgress();
  renderProgress();
}

async function confirmReplaceProgress() {
  const progress = loadProgress();
  if (!progress) return true;
  if (!confirm(`途中の「${progressLabel(progress)}」を諦めて、新しい問題を始めますか？\nこの問題は終了済みとして記録されます。`)) return false;
  try {
    await abandonProgress(progress);
    return true;
  } catch (error) {
    console.error(error);
    showStatus("終了記録を保存できなかったため、途中データは残しています。通信状態を確認してください。", "error");
    return false;
  }
}

function randomPick(items, random = Math.random) {
  return items.length ? items[Math.floor(random() * items.length)] : null;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedText) {
  let seed = hashSeed(seedText);
  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function withRandomSource(random, callback) {
  const original = Math.random;
  Math.random = random;
  try { return callback(); }
  finally { Math.random = original; }
}

function randomPuzzleSpecification(random = Math.random) {
  const type = randomPick(PUZZLE_TYPES, random);
  const difficulty = randomPick(DIFFICULTIES, random);
  return {
    type,
    difficulty,
    size: type === "sudoku"
      ? 9
      : type === "shikaku"
        ? randomPick(SHIKAKU_SIZES[difficulty], random)
        : numberlinkSizeForDifficulty(difficulty),
  };
}

function generate(type, difficulty, size) {
  if (type === "sudoku") return generatePuzzle(difficulty);
  if (type === "shikaku") return generateShikakuPuzzle(size, difficulty);
  return generateNumberlinkPuzzle(size, difficulty);
}

function generateWithRetries({ type, difficulty, size }) {
  const attempts = type === "sudoku" ? 10 : type === "shikaku" ? 3 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = generate(type, difficulty, size);
    if (result) return result;
  }
  return null;
}

function renderDailyPuzzle(puzzle) {
  if (!puzzle) return;
  const suffix = puzzle.type === "sudoku" ? "" : `（${puzzle.size} × ${puzzle.size}）`;
  $("#daily-icon").textContent = PUZZLE_ICONS[puzzle.type];
  $("#daily-title").textContent = `${DIFFICULTY_NAMES[puzzle.difficulty]}の${PUZZLE_NAMES[puzzle.type]}${suffix}`;
  $("#daily-date").textContent = `${puzzle.dateKey.replaceAll("-", "/")}・生成ポイント不要`;
}

function dailyStats() {
  if (!state.user) return getGuestDailyStats();
  return calculateDailyStats(state.userData?.clearHistory || [], state.userData?.finishHistory || []);
}

function renderDailyProgress() {
  const badge = $("#daily-state");
  const streak = $("#daily-streak");
  if (!badge || !streak) return;
  const stats = dailyStats();
  const clearedIds = new Set(state.user ? (state.userData?.clearedPuzzles || []) : []);
  const finishedIds = new Set(state.user
    ? [...(state.userData?.finishedPuzzles || []), ...(state.userData?.clearedPuzzles || [])]
    : getGuestFinishedPuzzleIds());
  const dailyId = state.dailyPuzzle?.id;
  const cleared = Boolean(dailyId && (clearedIds.has(dailyId) || stats.clearedToday));
  const completed = Boolean(dailyId && (finishedIds.has(dailyId) || stats.completedToday));

  state.dailyFinished = completed;
  badge.className = `daily-state${cleared ? " cleared" : completed ? " finished" : ""}`;
  badge.textContent = cleared ? "本日クリア済み" : completed ? "本日は終了済み" : "未挑戦";
  streak.textContent = stats.currentStreak > 0
    ? `🔥 ${stats.currentStreak}日連続クリア`
    : "連続クリア 0日";
  streak.title = `最長 ${stats.bestStreak}日連続`;
  dailyBtn.textContent = cleared ? "クリア済み" : completed ? "終了済み" : "すぐ解く";
  setBusy(state.busy);
}

async function ensureDailyPuzzle() {
  const cached = getCachedDailyPuzzle();
  const cacheIsCurrent = cached?.parameters?.algorithmVersion === DAILY_ALGORITHM_VERSION
    && (cached.type !== "shikaku" || cached.parameters?.generatorVersion === SHIKAKU_GENERATOR_VERSION)
    && (cached.type !== "numberlink" || cached.parameters?.generatorVersion === NUMBERLINK_GENERATOR_VERSION);
  if (cached && cacheIsCurrent) {
    state.dailyPuzzle = cached;
    state.dailyReady = true;
    renderDailyPuzzle(cached);
    renderDailyProgress();
    setBusy(state.busy);
    return cached;
  }

  state.dailyReady = false;
  $("#daily-title").textContent = "本日の問題を準備中…";
  $("#daily-date").textContent = "日本時間で毎日更新";
  setBusy(state.busy);
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    const dateKey = getJstDateKey();
    const random = seededRandom(`${DAILY_ALGORITHM_VERSION}:${dateKey}`);
    const generated = withRandomSource(random, () => {
      const specification = randomPuzzleSpecification(random);
      return { specification, puzzleData: generateWithRetries(specification) };
    });
    if (!generated.puzzleData) throw new Error("唯一解の本日の問題を生成できませんでした。ページを再読み込みしてください。");
    // 生成中に日本時間の日付が変わった場合は、古い日付の問題を保存せず新しい日で抽選し直します。
    if (dateKey !== getJstDateKey()) return ensureDailyPuzzle();
    const { type, difficulty, size } = generated.specification;
    const puzzle = {
      id: `daily-${dateKey.replaceAll("-", "")}`,
      dateKey,
      type,
      difficulty,
      size,
      problemData: generated.puzzleData.problemData ?? generated.puzzleData.puzzleData,
      solutionData: generated.puzzleData.solutionData ?? generated.puzzleData.solutionRects,
      parameters: {
        mode: "daily",
        algorithmVersion: DAILY_ALGORITHM_VERSION,
        uniqueSolutionVerified: true,
        ...(type === "shikaku" ? { generatorVersion: SHIKAKU_GENERATOR_VERSION } : {}),
        ...(type === "numberlink" ? { generatorVersion: NUMBERLINK_GENERATOR_VERSION } : {}),
      },
      createdAt: new Date().toISOString(),
    };
    cacheDailyPuzzle(puzzle);
    state.dailyPuzzle = puzzle;
    state.dailyReady = true;
    renderDailyPuzzle(puzzle);
    renderDailyProgress();
    setBusy(state.busy);
    return puzzle;
  } catch (error) {
    console.error(error);
    state.dailyPuzzle = null;
    state.dailyReady = false;
    $("#daily-title").textContent = "準備に失敗しました";
    $("#daily-date").textContent = "再読み込みすると再試行します";
    setBusy(state.busy);
    return null;
  }
}

async function userData() {
  if (!state.user) return null;
  if (!state.userData) state.userData = await fetchOrInitUser(state.user);
  return state.userData;
}

async function finishedIds() {
  if (!state.user) return new Set(getGuestFinishedPuzzleIds());
  const data = await userData();
  return new Set([...(data.finishedPuzzles || []), ...(data.clearedPuzzles || [])]);
}

function showNoStockDialog(type, difficulty, size) {
  const suffix = type === "sudoku" ? "" : `（${size} × ${size}）`;
  $("#stock-dialog-message").textContent = `${PUZZLE_NAMES[type]}${suffix}・${DIFFICULTY_NAMES[difficulty]}の未終了問題はありません。ログインすると、生成ポイントを1使って新しい問題を作れます。`;
  if (typeof stockDialog.showModal === "function") stockDialog.showModal();
  else alert($("#stock-dialog-message").textContent);
}

async function beginGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, provider);
    if (!(await checkUserExists(result.user.uid))) location.href = "./signup.html";
  } catch (error) {
    if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") return;
    console.error(error);
    showStatus(`ログインを完了できませんでした。${error?.code ? `（${error.code}）` : ""}`, "error");
  }
}

function puzzleUrl(type, difficulty, size, id, playMode = "normal") {
  const mode = playMode === "normal" ? "" : `&mode=${encodeURIComponent(playMode)}`;
  if (type === "sudoku") return `./puzzles/sudoku.html?diff=${difficulty}&id=${encodeURIComponent(id)}${mode}`;
  if (type === "shikaku") return `./puzzles/shikaku.html?size=${size}&diff=${difficulty}&id=${encodeURIComponent(id)}${mode}`;
  return `./puzzles/numberlink.html?size=${size}&diff=${difficulty}&id=${encodeURIComponent(id)}${mode}`;
}

async function startPuzzle({ type, difficulty, size = null }) {
  if (state.busy || !(await confirmReplaceProgress())) return;
  setBusy(true);
  showStatus("Firestoreから問題を探しています…");

  try {
    const fetched = await fetchPuzzles({ type, difficulty, size });
    const available = fetched.filter((item) => {
      if (["challenge", "daily"].includes(item.parameters?.mode)) return false;
      if (type === "shikaku") return item.parameters?.generatorVersion === SHIKAKU_GENERATOR_VERSION;
      if (type === "numberlink") return item.parameters?.generatorVersion === NUMBERLINK_GENERATOR_VERSION;
      return true;
    });
    const finished = await finishedIds();
    const targetFromStock = randomPick(available.filter((item) => !finished.has(item.id)));
    let target = targetFromStock;

    if (!target && !state.user) {
      showStatus("");
      showNoStockDialog(type, difficulty, size);
      return;
    }

    if (!target) {
      const data = await userData();
      const stamina = calculateGenerationPoints(data);
      if (!data.isAdmin && stamina.points <= 0) {
        showStatus("未終了の問題がなく、生成ポイントも0です。次の回復を待つか、別の条件を選んでください。", "error");
        return;
      }
      showStatus("唯一解を確認しながら、新しい問題を生成しています…");
      const puzzleData = generateWithRetries({ type, difficulty, size });
      if (!puzzleData) throw new Error("唯一解の問題を生成できませんでした。もう一度お試しください。");
      const id = await createGeneratedPuzzle(state.user, {
        type,
        difficulty,
        size: type === "sudoku" ? 9 : size,
        puzzleData,
        parameters: {
          mode: "normal",
          uniqueSolutionVerified: true,
          ...(type === "shikaku" ? {
            generatorVersion: SHIKAKU_GENERATOR_VERSION,
            generatedWithoutUnitCells: true,
          } : {}),
          ...(type === "numberlink" ? { generatorVersion: NUMBERLINK_GENERATOR_VERSION } : {}),
        },
      });
      target = { id };
    }

    location.href = puzzleUrl(type, difficulty, size, target.id);
  } catch (error) {
    console.error(error);
    const detail = error?.code ? `（${error.code}）` : "";
    showStatus(`${error?.message || "問題を準備できませんでした。"}${detail}`, "error");
  } finally {
    setBusy(false);
  }
}

async function startDailyPuzzle() {
  if (state.busy || !state.dailyPuzzle || !(await confirmReplaceProgress())) return;
  const finished = await finishedIds();
  if (finished.has(state.dailyPuzzle.id)) {
    showStatus("今日のおすすめ問題は終了済みです。次の問題は日本時間の午前0時に更新されます。", "success");
    return;
  }
  const { type, difficulty, size, id } = state.dailyPuzzle;
  location.href = puzzleUrl(type, difficulty, size, id, "daily");
}

async function startChallenge() {
  if (state.busy) return;
  if (!state.user) {
    showStatus("チャレンジゲームにはログインが必要です。Googleログインを完了してから、もう一度お試しください。", "error");
    await beginGoogleLogin();
    return;
  }
  if (!(await confirmReplaceProgress())) return;

  const data = await userData();
  const stamina = calculateGenerationPoints(data);
  if (stamina.points <= 0) {
    showStatus("生成ポイントが0のため、チャレンジを開始できません。次の回復をお待ちください。", "error");
    return;
  }
  if (!confirm("生成ポイントを1使って、ランダムなチャレンジを開始しますか？\n開始後は途中保存できず、退出すると途中棄権になります。")) return;

  setBusy(true);
  showStatus("ゲームタイプ・難易度・盤面条件を抽選し、唯一解を確認しています…");
  try {
    const specification = randomPuzzleSpecification();
    const puzzleData = generateWithRetries(specification);
    if (!puzzleData) throw new Error("チャレンジ問題を生成できませんでした。ポイントは消費されていません。もう一度お試しください。");
    const { type, difficulty, size } = specification;
    const id = await createGeneratedPuzzle(state.user, {
      type,
      difficulty,
      size,
      puzzleData,
      chargeAdmin: true,
      parameters: {
        mode: "challenge",
        uniqueSolutionVerified: true,
        ...(type === "shikaku" ? {
          generatorVersion: SHIKAKU_GENERATOR_VERSION,
          generatedWithoutUnitCells: true,
        } : {}),
        ...(type === "numberlink" ? { generatorVersion: NUMBERLINK_GENERATOR_VERSION } : {}),
      },
    });
    clearProgress();
    sessionStorage.setItem(`yourlogic:challenge-session:${id}`, "new");
    location.href = puzzleUrl(type, difficulty, size, id, "challenge");
  } catch (error) {
    console.error(error);
    const detail = error?.code ? `（${error.code}）` : "";
    showStatus(`${error?.message || "チャレンジを開始できませんでした。"}${detail}`, "error");
  } finally {
    setBusy(false);
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.userData = null;
  state.authReady = true;
  setBusy(false);
  if (!user) {
    loginBtn.hidden = false;
    userActions.hidden = true;
    clearInterval(staminaInterval);
    renderStamina();
    renderDailyProgress();
    return;
  }

  loginBtn.hidden = true;
  userActions.hidden = false;
  userName.textContent = user.displayName || user.email || "プレイヤー";
  try {
    if (!(await checkUserExists(user.uid))) {
      location.href = "./signup.html";
      return;
    }
    await syncGenerationPoints(user.uid);
    onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      if (!snapshot.exists()) return;
      state.userData = snapshot.data();
      userName.textContent = state.userData.displayName || user.displayName || "プレイヤー";
      beginStaminaClock();
      renderDailyProgress();
    }, (error) => {
      console.error(error);
      showStatus(`アカウント情報を同期できませんでした。（${error.code || "unknown"}）`, "error");
    });
  } catch (error) {
    console.error(error);
    showStatus(`アカウント情報を読み込めませんでした。（${error.code || "unknown"}）`, "error");
  }
});

loginBtn.addEventListener("click", beginGoogleLogin);
$("#dialog-login-btn").addEventListener("click", (event) => {
  event.preventDefault();
  stockDialog.close();
  beginGoogleLogin();
});
logoutBtn.addEventListener("click", async () => {
  if (!confirm("ログアウトしますか？")) return;
  try { await signOut(auth); }
  catch (error) { showStatus(`ログアウトできませんでした。（${error.code || "unknown"}）`, "error"); }
});

$("#resume-btn").addEventListener("click", () => {
  const progress = loadProgress();
  if (progress) location.href = progressUrl(progress);
});

$("#discard-progress-btn").addEventListener("click", async () => {
  const progress = loadProgress();
  if (!progress || !confirm("途中のパズルを諦めますか？\nこの問題は終了済みとして記録されます。")) return;
  try {
    await abandonProgress(progress);
    showStatus("問題を「諦めた」として記録し、途中データを破棄しました。", "success");
  } catch (error) {
    console.error(error);
    showStatus("終了記録を保存できなかったため、途中データは残しています。", "error");
  }
});

sudokuBtn.addEventListener("click", () => startPuzzle({ type: "sudoku", difficulty: state.sudokuDifficulty, size: 9 }));
dailyBtn.addEventListener("click", startDailyPuzzle);
challengeBtn.addEventListener("click", startChallenge);
shikakuBtn.addEventListener("click", () => startPuzzle({
  type: "shikaku",
  difficulty: state.shikakuDifficulty,
  size: Number(sizeSelect.value),
}));
numberlinkBtn.addEventListener("click", () => startPuzzle({
  type: "numberlink",
  difficulty: state.numberlinkDifficulty,
  size: numberlinkSizeForDifficulty(state.numberlinkDifficulty),
}));

window.addEventListener("yourlogic:progress", renderProgress);
renderShikakuSizes();
renderProgress();
setBusy(false);
void ensureDailyPuzzle();
clearInterval(dailyRefreshInterval);
dailyRefreshInterval = setInterval(() => {
  if (state.dailyPuzzle?.dateKey !== getJstDateKey()) void ensureDailyPuzzle();
}, 60 * 1000);

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(context.registerTool({
      name: "configure_puzzle",
      title: "パズルを選ぶ",
      description: "YourLogicの画面上で、遊ぶパズル・難易度・盤面サイズを選択します。",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: PUZZLE_TYPES },
          difficulty: { type: "string", enum: DIFFICULTIES },
          size: { type: "integer", enum: [5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50] },
        },
        required: ["type", "difficulty"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !PUZZLE_TYPES.includes(input.type)) throw new Error("invalid type");
        if (!DIFFICULTIES.includes(input.difficulty)) throw new Error("invalid difficulty");
        const group = document.querySelector(`[data-choice-group="${input.type}"]`);
        const button = group?.querySelector(`[data-value="${input.difficulty}"]`);
        if (!group || !button) throw new Error("puzzle controls are unavailable");
        choose(group, button);
        if (input.type === "shikaku" && input.size !== undefined) {
          if (!SHIKAKU_SIZES[input.difficulty].includes(input.size)) throw new Error("size is unavailable for this difficulty");
          sizeSelect.value = String(input.size);
        }
        group.closest(".puzzle-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
        const selectedSize = input.type === "shikaku"
          ? Number(sizeSelect.value)
          : input.type === "numberlink"
            ? numberlinkSizeForDifficulty(input.difficulty)
            : 9;
        return { configured: true, type: input.type, difficulty: input.difficulty, size: selectedSize };
      },
    }, { signal: lifecycle.signal })).catch((error) => console.error("WebMCP registration failed", error));
  } catch (error) {
    console.error("WebMCP registration failed", error);
  }
}

registerWebMcp();
const autoParams = new URLSearchParams(location.search);
const autoMode = autoParams.get("auto");
if (["sudoku", "shikaku", "numberlink", "challenge"].includes(autoMode)) {
  const difficulty = DIFFICULTIES.includes(autoParams.get("diff")) ? autoParams.get("diff") : "easy";
  const waitForAuth = setInterval(() => {
    if (!state.authReady) return;
    clearInterval(waitForAuth);
    if (autoMode === "challenge") {
      void startChallenge();
      return;
    }
    const requestedSize = Number(autoParams.get("size"));
    const size = autoMode === "shikaku" && SHIKAKU_SIZES[difficulty].includes(requestedSize)
      ? requestedSize
      : autoMode === "shikaku"
        ? SHIKAKU_SIZES[difficulty][0]
        : autoMode === "numberlink"
          ? numberlinkSizeForDifficulty(difficulty)
          : 9;
    void startPuzzle({ type: autoMode, difficulty, size });
  }, 50);
}
