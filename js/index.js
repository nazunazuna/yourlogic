import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  auth, db, provider, calculateGenerationPoints, checkUserExists,
  createGeneratedPuzzle, fetchOrInitUser, fetchPuzzles,
  getGuestFinishedPuzzleIds, markPuzzleFinished, syncGenerationPoints,
  MAX_GENERATION_POINTS,
} from "./services/firebaseService.js?v=20260916-2";
import { generatePuzzle } from "./puzzles/sudoku/sudokuGenerator.js";
import { generateShikakuPuzzle } from "./puzzles/shikaku/shikakuGenerator.js";
import { clearProgress, loadProgress, progressLabel, progressUrl } from "./core/progressStore.js";

const SHIKAKU_SIZES = {
  easy: [5, 10],
  standard: [10, 15, 20, 25, 30],
  hard: [20, 25, 30, 40],
  insane: [30, 40, 50],
};
const state = {
  user: null,
  userData: null,
  sudokuDifficulty: "easy",
  shikakuDifficulty: "easy",
  busy: false,
  authReady: false,
  syncingPoints: false,
};
let staminaInterval = null;

const $ = (selector) => document.querySelector(selector);
const loginBtn = $("#login-btn");
const logoutBtn = $("#logout-btn");
const userActions = $("#user-actions");
const userName = $("#user-name");
const status = $("#home-status");
const sudokuBtn = $("#start-sudoku-btn");
const shikakuBtn = $("#start-shikaku-btn");
const dailyBtn = $("#daily-btn");
const sizeSelect = $("#shikaku-size");
const stockDialog = $("#stock-dialog");

function showStatus(message, tone = "") {
  status.textContent = message;
  status.className = `notice shell ${tone}`.trim();
  status.hidden = !message;
}

function setBusy(busy) {
  state.busy = busy;
  [sudokuBtn, shikakuBtn, dailyBtn].forEach((button) => { button.disabled = busy || !state.authReady; });
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
  } else {
    state.shikakuDifficulty = button.dataset.value;
    renderShikakuSizes();
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
  if (!state.user || !state.userData) {
    box.hidden = true;
    return;
  }
  const { points, nextPointAtMs } = calculateGenerationPoints(state.userData);
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

function stableDailyPick(items) {
  if (!items.length) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const score = [...date].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
  return items[score % items.length];
}

function randomPick(items) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
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
  const game = type === "sudoku" ? "数独" : "四角に切れ";
  const suffix = type === "shikaku" ? `（${size} × ${size}）` : "";
  $("#stock-dialog-message").textContent = `${game}${suffix}・${({ easy: "初級", standard: "中級", hard: "上級", insane: "超上級" })[difficulty]}の未終了問題はありません。ログインすると、生成ポイントを1使って新しい問題を作れます。`;
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

function generate(type, difficulty, size) {
  if (type === "sudoku") return generatePuzzle(difficulty);
  return generateShikakuPuzzle(size, difficulty);
}

function puzzleUrl(type, difficulty, size, id) {
  if (type === "sudoku") return `./puzzles/sudoku.html?diff=${difficulty}&id=${encodeURIComponent(id)}`;
  return `./puzzles/shikaku.html?size=${size}&diff=${difficulty}&id=${encodeURIComponent(id)}`;
}

async function startPuzzle({ type, difficulty, size = null, daily = false }) {
  if (state.busy || !(await confirmReplaceProgress())) return;
  setBusy(true);
  showStatus("Firestoreから問題を探しています…");

  try {
    const available = await fetchPuzzles({ type, difficulty, size });
    const finished = await finishedIds();
    const unplayed = available.filter((item) => !finished.has(item.id));
    let target = daily ? stableDailyPick(unplayed) : randomPick(unplayed);

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
      const puzzleData = generate(type, difficulty, size);
      if (!puzzleData) throw new Error("唯一解の問題を生成できませんでした。もう一度お試しください。");
      const id = await createGeneratedPuzzle(state.user, {
        type,
        difficulty,
        size: type === "sudoku" ? 9 : size,
        puzzleData,
        parameters: type === "shikaku" ? { uniqueSolutionVerified: true } : { uniqueSolutionVerified: true },
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
dailyBtn.addEventListener("click", () => startPuzzle({ type: "sudoku", difficulty: "standard", size: 9, daily: true }));
shikakuBtn.addEventListener("click", () => startPuzzle({
  type: "shikaku",
  difficulty: state.shikakuDifficulty,
  size: Number(sizeSelect.value),
}));

window.addEventListener("yourlogic:progress", renderProgress);
renderShikakuSizes();
renderProgress();
setBusy(false);

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(context.registerTool({
      name: "configure_puzzle",
      title: "パズルを選ぶ",
      description: "YourLogicの画面上で、遊ぶパズル・難易度・四角に切れの盤面サイズを選択します。",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["sudoku", "shikaku"] },
          difficulty: { type: "string", enum: ["easy", "standard", "hard", "insane"] },
          size: { type: "integer", enum: [5, 10, 15, 20, 25, 30, 40, 50] },
        },
        required: ["type", "difficulty"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["sudoku", "shikaku"].includes(input.type)) throw new Error("invalid type");
        if (!["easy", "standard", "hard", "insane"].includes(input.difficulty)) throw new Error("invalid difficulty");
        const group = document.querySelector(`[data-choice-group="${input.type}"]`);
        const button = group?.querySelector(`[data-value="${input.difficulty}"]`);
        if (!group || !button) throw new Error("puzzle controls are unavailable");
        choose(group, button);
        if (input.type === "shikaku" && input.size !== undefined) {
          if (!SHIKAKU_SIZES[input.difficulty].includes(input.size)) throw new Error("size is unavailable for this difficulty");
          sizeSelect.value = String(input.size);
        }
        group.closest(".puzzle-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return { configured: true, type: input.type, difficulty: input.difficulty, size: input.type === "shikaku" ? Number(sizeSelect.value) : 9 };
      },
    }, { signal: lifecycle.signal })).catch((error) => console.error("WebMCP registration failed", error));
  } catch (error) {
    console.error("WebMCP registration failed", error);
  }
}

registerWebMcp();
const auto = new URLSearchParams(location.search).get("auto");
if (auto === "sudoku") {
  const difficulty = new URLSearchParams(location.search).get("diff") || "easy";
  const waitForAuth = setInterval(() => {
    if (!state.authReady) return;
    clearInterval(waitForAuth);
    startPuzzle({ type: "sudoku", difficulty, size: 9 });
  }, 50);
}
