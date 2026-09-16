import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  arrayUnion, collection, doc, getDoc, getDocs, getFirestore, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  decodePuzzleDataFromFirestore,
  encodePuzzleDataForFirestore,
} from "../core/puzzleDataCodec.js?v=20260916-2";

const firebaseConfig = {
  apiKey: "AIzaSyCkbdX-B6FfIVplmG98tIvxO0uUv-mYDSw",
  authDomain: "yourlogic-c0b64.firebaseapp.com",
  projectId: "yourlogic-c0b64",
  storageBucket: "yourlogic-c0b64.firebasestorage.app",
  messagingSenderId: "774656497074",
  appId: "1:774656497074:web:07d6d6092d5d176224c0ab",
  measurementId: "G-W4VM6FC3J5",
};

export const MAX_GENERATION_POINTS = 5;
export const GENERATION_RECOVERY_MS = 2 * 60 * 60 * 1000;
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function toMillis(value, fallback = Date.now()) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || fallback).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateGenerationPoints(userData, now = Date.now()) {
  let points = Math.max(0, Math.min(MAX_GENERATION_POINTS, Number(userData?.generationPoints ?? MAX_GENERATION_POINTS)));
  let updatedAtMs = toMillis(userData?.lastPointUpdatedAt, now);

  if (points < MAX_GENERATION_POINTS) {
    const recovered = Math.floor(Math.max(0, now - updatedAtMs) / GENERATION_RECOVERY_MS);
    if (recovered > 0) {
      points = Math.min(MAX_GENERATION_POINTS, points + recovered);
      updatedAtMs += recovered * GENERATION_RECOVERY_MS;
    }
  }

  return {
    points,
    updatedAtMs,
    nextPointAtMs: points < MAX_GENERATION_POINTS ? updatedAtMs + GENERATION_RECOVERY_MS : null,
  };
}

function initialUserData(displayName = "") {
  return {
    displayName,
    generationPoints: MAX_GENERATION_POINTS,
    lastPointUpdatedAt: new Date(),
    nextPointAt: null,
    generatedPuzzles: [],
    finishedPuzzles: [],
    clearedPuzzles: [],
    records: {},
    clearHistory: [],
    finishHistory: [],
    isAdmin: false,
  };
}

export async function fetchOrInitUser(user) {
  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return snapshot.data();
  const data = initialUserData(user.displayName || "");
  await setDoc(ref, data);
  return data;
}

export async function checkUserExists(uid) {
  return (await getDoc(doc(db, "users", uid))).exists();
}

export async function registerNewUser(uid, displayName) {
  const data = initialUserData(displayName);
  await setDoc(doc(db, "users", uid), data);
  return data;
}

/** type/difficulty で取得し、四角に切れのみ size を絞り込みます。 */
export async function fetchPuzzles({ type, difficulty, size = null }) {
  const snapshot = await getDocs(query(
    collection(db, "puzzles"),
    where("type", "==", type),
    where("difficulty", "==", difficulty),
  ));
  const puzzles = [];
  snapshot.forEach((item) => {
    const value = decodePuzzleDataFromFirestore({ id: item.id, ...item.data() });
    if (size === null || Number(value.size) === Number(size)) puzzles.push(value);
  });
  return puzzles;
}

export function fetchPuzzlesByDifficulty(difficulty, type = "sudoku", size = null) {
  return fetchPuzzles({ type, difficulty, size });
}

export async function fetchPuzzleById(puzzleId) {
  const snapshot = await getDoc(doc(db, "puzzles", puzzleId));
  return snapshot.exists()
    ? decodePuzzleDataFromFirestore({ id: snapshot.id, ...snapshot.data() })
    : null;
}

function puzzleDocument(uid, { type, difficulty, size, puzzleData, parameters = {} }) {
  const problemData = puzzleData.problemData ?? puzzleData.puzzleData;
  const solutionData = puzzleData.solutionData ?? puzzleData.solutionRects;
  if (!problemData || !solutionData) throw new Error("問題データまたは解答データがありません。");
  const encoded = encodePuzzleDataForFirestore({
    type, size, problemData, solutionData, parameters,
  });
  return {
    type,
    difficulty,
    size: Number(size || (type === "sudoku" ? 9 : 0)),
    ...encoded,
    generatedBy: uid,
    createdAt: serverTimestamp(),
  };
}

/** 問題保存・生成ポイント消費・生成履歴を一つのトランザクションで確定します。 */
export async function createGeneratedPuzzle(user, specification) {
  if (!user?.uid) throw new Error("ログインが必要です。");
  const userRef = doc(db, "users", user.uid);
  const puzzleRef = doc(collection(db, "puzzles"));
  const now = Date.now();

  await runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists()) throw new Error("ユーザーデータが見つかりません。");
    const userData = userSnapshot.data();
    const stamina = calculateGenerationPoints(userData, now);
    const isAdmin = userData.isAdmin === true;
    if (!isAdmin && stamina.points <= 0) {
      const error = new Error("生成ポイントがありません。");
      error.code = "generation-points-empty";
      throw error;
    }

    const remaining = isAdmin ? stamina.points : stamina.points - 1;
    const timerBase = !isAdmin && stamina.points >= MAX_GENERATION_POINTS ? now : stamina.updatedAtMs;
    transaction.set(puzzleRef, puzzleDocument(user.uid, specification));
    transaction.update(userRef, {
      generationPoints: remaining,
      lastPointUpdatedAt: new Date(timerBase),
      nextPointAt: remaining < MAX_GENERATION_POINTS
        ? new Date(timerBase + GENERATION_RECOVERY_MS)
        : null,
      generatedPuzzles: arrayUnion(puzzleRef.id),
    });
  });

  return puzzleRef.id;
}

// 旧コードとの互換用。新しい出題フローでは createGeneratedPuzzle() を使用します。
export async function saveNewPuzzle(uid, difficulty, puzzleData) {
  const puzzleRef = doc(collection(db, "puzzles"));
  await setDoc(puzzleRef, puzzleDocument(uid, {
    type: "sudoku", difficulty, size: 9, puzzleData,
  }));
  if (uid) await updateDoc(doc(db, "users", uid), { generatedPuzzles: arrayUnion(puzzleRef.id) });
  return puzzleRef.id;
}

export async function updateUserStamina(uid, points, updatedAt) {
  const nextPointAt = points < MAX_GENERATION_POINTS
    ? new Date(toMillis(updatedAt) + GENERATION_RECOVERY_MS)
    : null;
  await updateDoc(doc(db, "users", uid), {
    generationPoints: points,
    lastPointUpdatedAt: updatedAt,
    nextPointAt,
  });
}

export async function syncGenerationPoints(uid) {
  const userRef = doc(db, "users", uid);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) return;
    const before = snapshot.data();
    const after = calculateGenerationPoints(before);
    const beforeNext = before.nextPointAt ? toMillis(before.nextPointAt, 0) : null;
    const nextMatches = beforeNext === after.nextPointAtMs
      || (beforeNext !== null && after.nextPointAtMs !== null && Math.abs(beforeNext - after.nextPointAtMs) < 1000);
    if (after.points === Number(before.generationPoints ?? MAX_GENERATION_POINTS) && nextMatches) return;
    transaction.update(userRef, {
      generationPoints: after.points,
      lastPointUpdatedAt: new Date(after.updatedAtMs),
      nextPointAt: after.nextPointAtMs ? new Date(after.nextPointAtMs) : null,
    });
  });
}

const GUEST_FINISHED_KEY = "yourlogic:guest-finished:v1";
const GUEST_HISTORY_KEY = "yourlogic:guest-finish-history:v1";

function safeArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function getGuestFinishedPuzzleIds() {
  const legacy = safeArray("guest_cleared_puzzles");
  return Array.from(new Set([...safeArray(GUEST_FINISHED_KEY), ...legacy]));
}

function saveGuestFinish(record) {
  const ids = getGuestFinishedPuzzleIds();
  if (!ids.includes(record.puzzleId)) ids.push(record.puzzleId);
  localStorage.setItem(GUEST_FINISHED_KEY, JSON.stringify(ids));
  const history = safeArray(GUEST_HISTORY_KEY);
  if (!history.some((item) => item.puzzleId === record.puzzleId)) history.push(record);
  localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(history.slice(-500)));
}

function finishRecord(puzzleId, outcome, metadata = {}) {
  return {
    puzzleId,
    outcome,
    type: metadata.type || "sudoku",
    difficulty: metadata.difficulty || "unknown",
    size: Number(metadata.size || (metadata.type === "sudoku" ? 9 : 0)),
    elapsedTime: Number(metadata.elapsedTime || 0),
    finishedAt: new Date().toISOString(),
  };
}

export async function markPuzzleFinished(uid, puzzleId, outcome = "abandoned", metadata = {}) {
  if (!puzzleId) return;
  const record = finishRecord(puzzleId, outcome, metadata);
  if (!uid) {
    saveGuestFinish(record);
    return;
  }
  await setDoc(doc(db, "users", uid), {
    finishedPuzzles: arrayUnion(puzzleId),
    finishHistory: arrayUnion(record),
  }, { merge: true });
}

export async function saveClearRecord(uid, puzzleId, elapsedTime = 0, metadata = {}) {
  const finished = finishRecord(puzzleId, "cleared", { ...metadata, elapsedTime });
  const clearRecord = { ...finished, clearedAt: finished.finishedAt };
  if (uid) {
    const userRef = doc(db, "users", uid);
    try {
      await updateDoc(userRef, {
        finishedPuzzles: arrayUnion(puzzleId),
        clearedPuzzles: arrayUnion(puzzleId),
        [`records.${puzzleId}`]: elapsedTime,
        clearHistory: arrayUnion(clearRecord),
        finishHistory: arrayUnion(finished),
      });
    } catch (error) {
      await setDoc(userRef, {
        finishedPuzzles: [puzzleId],
        clearedPuzzles: [puzzleId],
        records: { [puzzleId]: elapsedTime },
        clearHistory: [clearRecord],
        finishHistory: [finished],
      }, { merge: true });
    }
    return;
  }

  saveGuestFinish(finished);
  const cleared = safeArray("guest_cleared_puzzles");
  if (!cleared.includes(puzzleId)) cleared.push(puzzleId);
  localStorage.setItem("guest_cleared_puzzles", JSON.stringify(cleared));
  const times = JSON.parse(localStorage.getItem("guest_clear_times") || "{}");
  times[puzzleId] = elapsedTime;
  localStorage.setItem("guest_clear_times", JSON.stringify(times));
  const history = safeArray("guest_clear_history");
  history.push(clearRecord);
  localStorage.setItem("guest_clear_history", JSON.stringify(history.slice(-500)));
}

export async function mergeGuestData(uid) {
  const guestCleared = safeArray("guest_cleared_puzzles");
  const guestFinished = getGuestFinishedPuzzleIds();
  const guestTimes = JSON.parse(localStorage.getItem("guest_clear_times") || "{}");
  const guestClearHistory = safeArray("guest_clear_history");
  const guestFinishHistory = safeArray(GUEST_HISTORY_KEY);
  if (!guestCleared.length && !guestFinished.length) return;

  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  await setDoc(userRef, {
    clearedPuzzles: Array.from(new Set([...(current.clearedPuzzles || []), ...guestCleared])),
    finishedPuzzles: Array.from(new Set([...(current.finishedPuzzles || []), ...guestFinished])),
    records: { ...(current.records || {}), ...guestTimes },
    clearHistory: [...(current.clearHistory || []), ...guestClearHistory].slice(-500),
    finishHistory: [...(current.finishHistory || []), ...guestFinishHistory].slice(-500),
  }, { merge: true });

  ["guest_cleared_puzzles", "guest_clear_times", "guest_clear_history", GUEST_FINISHED_KEY, GUEST_HISTORY_KEY]
    .forEach((key) => localStorage.removeItem(key));
}
