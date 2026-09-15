import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  auth, db, provider, checkUserExists, fetchPuzzlesByDifficulty,
  saveNewPuzzle, updateUserStamina
} from "./services/firebaseService.js";
import { generatePuzzle } from "./puzzles/sudoku/sudokuGenerator.js";
import { clearProgress, loadProgress, progressLabel, progressUrl } from "./core/progressStore.js";

const MAX_STAMINA = 5;
const RECOVERY_MS = 5 * 60 * 60 * 1000;
const state = { user: null, userData: null, sudokuDifficulty: "easy", shikakuDifficulty: "easy", busy: false };
let staminaInterval = null;

const $ = (selector) => document.querySelector(selector);
const loginBtn = $("#login-btn");
const logoutBtn = $("#logout-btn");
const userActions = $("#user-actions");
const userName = $("#user-name");
const status = $("#home-status");
const sudokuBtn = $("#start-sudoku-btn");
const dailyBtn = $("#daily-btn");

function showStatus(message, tone = "") {
  status.textContent = message;
  status.className = `notice shell ${tone}`.trim();
  status.hidden = !message;
}

function renderProgress() {
  const progress = loadProgress();
  const panel = $("#resume-panel");
  panel.hidden = !progress;
  if (progress) $("#resume-label").textContent = progressLabel(progress);
}

function choose(group, button) {
  group.querySelectorAll(".choice").forEach((item) => {
    const selected = item === button;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
  if (group.dataset.choiceGroup === "sudoku") state.sudokuDifficulty = button.dataset.value;
  else state.shikakuDifficulty = button.dataset.value;
}

document.querySelectorAll("[data-choice-group]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest(".choice");
    if (button) choose(group, button);
  });
});

function staminaNow(userData) {
  let points = Number(userData?.generationPoints ?? MAX_STAMINA);
  const rawUpdated = userData?.lastPointUpdatedAt;
  let updated = rawUpdated?.toDate ? rawUpdated.toDate().getTime() : new Date(rawUpdated || Date.now()).getTime();
  const elapsed = Math.max(0, Date.now() - updated);
  if (points < MAX_STAMINA && elapsed >= RECOVERY_MS) {
    const recovered = Math.floor(elapsed / RECOVERY_MS);
    points = Math.min(MAX_STAMINA, points + recovered);
    updated += recovered * RECOVERY_MS;
  }
  return { points, updated, next: points < MAX_STAMINA ? Math.max(0, RECOVERY_MS - (Date.now() - updated)) : 0 };
}

function renderStamina() {
  const box = $("#stamina");
  if (!state.user || !state.userData) { box.hidden = true; return; }
  const { points, next } = staminaNow(state.userData);
  box.hidden = false;
  $("#stamina-count").textContent = `${points} / ${MAX_STAMINA}`;
  if (!next) { $("#stamina-timer").textContent = ""; return; }
  const seconds = Math.floor(next / 1000);
  $("#stamina-timer").textContent = `次まで ${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function beginStaminaClock() {
  clearInterval(staminaInterval);
  renderStamina();
  staminaInterval = setInterval(renderStamina, 1000);
}

function confirmReplaceProgress() {
  const progress = loadProgress();
  if (!progress) return true;
  if (!confirm(`途中の「${progressLabel(progress)}」を破棄して、新しい問題を始めますか？`)) return false;
  clearProgress();
  renderProgress();
  return true;
}

function localSudoku(difficulty) {
  const puzzle = generatePuzzle(difficulty);
  if (!puzzle) throw new Error("問題を生成できませんでした。");
  const id = `sudoku-local-${crypto.randomUUID?.() || Date.now()}`;
  sessionStorage.setItem("yourlogic:local-sudoku", JSON.stringify({ id, difficulty, ...puzzle }));
  return id;
}

function stableDailyPick(items) {
  if (!items.length) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const score = [...date].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
  return items[score % items.length];
}

async function startSudoku(difficulty, daily = false) {
  if (state.busy || !confirmReplaceProgress()) return;
  state.busy = true;
  sudokuBtn.disabled = true;
  dailyBtn.disabled = true;
  showStatus("問題を準備しています…");

  try {
    const available = await fetchPuzzlesByDifficulty(difficulty);
    let target = null;

    if (state.user) {
      const cleared = state.userData?.clearedPuzzles || [];
      const unplayed = available.filter((item) => !cleared.includes(item.id));
      target = daily ? stableDailyPick(unplayed) : unplayed[0];
      if (!target) {
        const { points, updated } = staminaNow(state.userData);
        if (points > 0 || state.userData?.isAdmin) {
          const generated = generatePuzzle(difficulty);
          if (!generated) throw new Error("問題生成に失敗しました。");
          const id = await saveNewPuzzle(state.user.uid, difficulty, generated);
          if (!state.userData?.isAdmin) {
            await updateUserStamina(state.user.uid, points - 1, new Date(points === MAX_STAMINA ? Date.now() : updated));
          }
          window.location.href = `./puzzles/sudoku.html?diff=${difficulty}&id=${encodeURIComponent(id)}`;
          return;
        }
      }
    } else {
      target = daily ? stableDailyPick(available) : available[0];
    }

    const id = target?.id || localSudoku(difficulty);
    window.location.href = `./puzzles/sudoku.html?diff=${difficulty}&id=${encodeURIComponent(id)}`;
  } catch (error) {
    console.error(error);
    try {
      const id = localSudoku(difficulty);
      window.location.href = `./puzzles/sudoku.html?diff=${difficulty}&id=${encodeURIComponent(id)}`;
      return;
    } catch {
      showStatus("問題を準備できませんでした。通信状態を確認して、もう一度お試しください。", "error");
    }
  } finally {
    state.busy = false;
    sudokuBtn.disabled = false;
    dailyBtn.disabled = false;
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.userData = null;
  if (!user) {
    loginBtn.hidden = false;
    userActions.hidden = true;
    clearInterval(staminaInterval);
    renderStamina();
    return;
  }

  try {
    if (!(await checkUserExists(user.uid))) {
      window.location.href = "./signup.html";
      return;
    }
    loginBtn.hidden = true;
    userActions.hidden = false;
    userName.textContent = user.displayName || user.email || "プレイヤー";
    onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      if (!snapshot.exists()) return;
      state.userData = snapshot.data();
      userName.textContent = state.userData.displayName || user.displayName || "プレイヤー";
      beginStaminaClock();
    });
  } catch (error) {
    console.error(error);
    showStatus("アカウント情報を読み込めませんでした。ゲストとしてパズルは遊べます。", "error");
  }
});

loginBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    if (!(await checkUserExists(result.user.uid))) window.location.href = "./signup.html";
  } catch (error) {
    if (error?.code !== "auth/popup-closed-by-user") showStatus("ログインを完了できませんでした。", "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  if (confirm("ログアウトしますか？")) await signOut(auth);
});

$("#resume-btn").addEventListener("click", () => {
  const progress = loadProgress();
  if (progress) window.location.href = progressUrl(progress);
});

$("#discard-progress-btn").addEventListener("click", () => {
  if (!confirm("途中のパズルを破棄しますか？")) return;
  clearProgress();
  renderProgress();
});

sudokuBtn.addEventListener("click", () => startSudoku(state.sudokuDifficulty));
dailyBtn.addEventListener("click", () => startSudoku("standard", true));

$("#start-shikaku-btn").addEventListener("click", () => {
  if (!confirmReplaceProgress()) return;
  const size = Number($("#shikaku-size").value);
  const id = `shikaku-${crypto.randomUUID?.() || Date.now()}`;
  window.location.href = `./puzzles/shikaku.html?size=${size}&diff=${state.shikakuDifficulty}&id=${encodeURIComponent(id)}`;
});

window.addEventListener("yourlogic:progress", renderProgress);
renderProgress();

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(context.registerTool({
      name: "configure_puzzle",
      title: "パズルを選ぶ",
      description: "YourLogicの画面上で、遊ぶパズル・難易度・四角に切れの盤面サイズを選択します。開始はせず、選択状態だけを変更します。",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["sudoku", "shikaku"] },
          difficulty: { type: "string", enum: ["easy", "standard", "hard", "insane"] },
          size: { type: "integer", enum: [5, 10, 15, 20, 25, 30, 40, 50] }
        },
        required: ["type", "difficulty"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["sudoku", "shikaku"].includes(input.type)) throw new Error("type must be sudoku or shikaku");
        if (!["easy", "standard", "hard", "insane"].includes(input.difficulty)) throw new Error("invalid difficulty");
        if (input.type === "shikaku" && input.size !== undefined && ![5, 10, 15, 20, 25, 30, 40, 50].includes(input.size)) throw new Error("invalid size");
        const group = document.querySelector(`[data-choice-group="${input.type}"]`);
        const button = group?.querySelector(`[data-value="${input.difficulty}"]`);
        if (!group || !button) throw new Error("puzzle controls are unavailable");
        choose(group, button);
        if (input.type === "shikaku" && input.size !== undefined) $("#shikaku-size").value = String(input.size);
        group.closest(".puzzle-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return { configured: true, type: input.type, difficulty: input.difficulty, size: input.type === "shikaku" ? Number($("#shikaku-size").value) : 9 };
      }
    }, { signal: lifecycle.signal })).catch((error) => console.error("WebMCP registration failed", error));
  } catch (error) {
    console.error("WebMCP registration failed", error);
  }
}

registerWebMcp();

const auto = new URLSearchParams(location.search).get("auto");
if (auto === "sudoku") {
  const diff = new URLSearchParams(location.search).get("diff") || "easy";
  startSudoku(diff);
}
