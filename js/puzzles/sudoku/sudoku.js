import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, fetchOrInitUser, fetchPuzzleById, markPuzzleFinished, saveClearRecord } from "../../services/firebaseService.js?v=20260917-1";
import { executeHintLogic } from "./sudokuHint.js?v=20260917-1";
import { clearProgress, loadProgress, saveProgress } from "../../core/progressStore.js?v=20260917-1";
import { bindUndoShortcut, createUndoHistory } from "../../core/historyStore.js?v=20260917-1";

// グローバル状態
let currentUser = null;
let isAdmin = false;
let selectedCell = null;
let currentInputMode = 'location'; 
let selectedNumber = null;         
let isMemoMode = false;
let currentSolution = "";
let currentProblem = "";
let currentPuzzleId = null;
let gameFinished = false;
let completionState = null;
let mistakeIndexes = new Set();
let mistakeMessage = "❌ この数字は間違えています。消してやり直してみましょう。";

// ⏱️ タイマー関連の変数
let gameTimerId = null;
let elapsedTime = 0; 
let startTime = null; 

// DOM要素の取得
const statusText = document.getElementById('auth-status-text');
const memoBtn = document.getElementById('memo-btn');
const modeLocationBtn = document.getElementById('mode-location-btn');
const modeAutoBtn = document.getElementById('mode-auto-btn');
const hintTextArea = document.getElementById('hint-text-area');
const mistakePanel = document.getElementById('mistake-panel');
const mistakeMessageEl = document.getElementById('mistake-message');
const undoButton = document.getElementById('undo-btn');
const timerContainer = document.querySelector('.timer-area'); 
const gameTimerEl = document.getElementById('timer'); 

const urlParams = new URLSearchParams(window.location.search);
let currentDifficulty = urlParams.get('diff') || 'easy'; 
const targetPuzzleId = urlParams.get('id');
const requestedPlayMode = urlParams.get('mode');
const playMode = ['daily', 'challenge'].includes(requestedPlayMode) ? requestedPlayMode : 'normal';
const isChallenge = playMode === 'challenge';
const challengeSessionKey = targetPuzzleId ? `yourlogic:challenge-session:${targetPuzzleId}` : null;
const challengeReentry = Boolean(isChallenge && challengeSessionKey && sessionStorage.getItem(challengeSessionKey) === 'active');
if (isChallenge && challengeSessionKey && !challengeReentry) sessionStorage.setItem(challengeSessionKey, 'active');
const isResume = !isChallenge && urlParams.get('resume') === 'true';

if (isChallenge) clearProgress();
const playModeLabel = document.getElementById('play-mode-label');
if (playMode === 'daily') {
    playModeLabel.hidden = false;
    playModeLabel.textContent = '今日のおすすめ';
} else if (isChallenge) {
    playModeLabel.hidden = false;
    playModeLabel.textContent = 'チャレンジ・途中保存なし';
    document.getElementById('giveup-btn').textContent = '途中棄権する';
}

function guardFinished() {
    if (!gameFinished) return false;
    alert(completionState === 'cleared' ? "パズルはクリア済みです！" : "このパズルは終了済みです。");
    return true;
}

// 💡 ログイン状態の監視と初期化・復元ロジック
onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (isChallenge && !user) {
        gameFinished = true;
        completionState = 'login-required';
        if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
        statusText.innerText = "チャレンジゲームを続けるにはログインが必要です。ホームに戻ります。";
        setTimeout(() => { window.location.href = "../index.html"; }, 1200);
        return;
    }
    if (isChallenge && user && challengeReentry) {
        gameFinished = true;
        completionState = 'abandoned';
        statusText.innerText = "再読み込みされたチャレンジを途中棄権として記録しています…";
        try {
            await markPuzzleFinished(user.uid, targetPuzzleId, "abandoned", {
                type: "sudoku", difficulty: currentDifficulty, size: 9, elapsedTime: 0, mode: playMode,
            });
        } catch (error) {
            console.error("再読み込み時の途中棄権記録に失敗しました:", error);
        }
        sessionStorage.removeItem(challengeSessionKey);
        window.location.href = "../index.html";
        return;
    }
    
    if (user) {
        try {
            const userData = await fetchOrInitUser(user);
            isAdmin = userData?.isAdmin || false;

            statusText.innerText = isAdmin 
                ? `👑 管理者ログイン中: ${user.displayName}` 
                : `ログイン中: ${user.displayName}`;
        } catch (e) {
            console.error("ユーザーデータの初期化に失敗しました:", e);
            statusText.innerText = `ログイン中: ${user.displayName} (データ同期エラー)`;
        }
    } else {
        statusText.innerText = "ゲストモードプレイ中 (クリア実績はローカルに保存されます)";
        isAdmin = false;
    }

    let puzzleIdToLoad = targetPuzzleId;
    let savedProgress = null;

    if (isResume) {
        savedProgress = loadProgress();
        if (savedProgress?.type === "sudoku") puzzleIdToLoad = savedProgress.id;
    }

    if (puzzleIdToLoad) {
        try {
            await loadSpecificPuzzle(puzzleIdToLoad, savedProgress);

            if (isResume && savedProgress) {
                currentDifficulty = savedProgress.difficulty || currentDifficulty;
                renderBoard(savedProgress.board);
                startGameTimer(savedProgress.elapsedTime); 
                
                if (currentUser) {
                    statusText.innerText = isAdmin 
                        ? `👑 管理者ログイン中: ${currentUser.displayName} (パズルID: ${currentPuzzleId} - 再開)`
                        : `ログイン中: ${currentUser.displayName} (パズルID: ${currentPuzzleId} - 再開)`;
                }
            }
        } catch (error) {
            console.error("パズルの読み込み・復元に失敗しました:", error);
            alert("問題の読み込みに失敗しました。ホームに戻ります。");
            window.location.href = "../index.html";
        }
    } else {
        console.log("パズルIDが指定されていません。ホーム画面で自動選定を行います。");
        window.location.href = `../index.html?auto=sudoku&diff=${currentDifficulty}`;
    }
});

// ⏱️ 経過時間タイマーの始動ロジック
function startGameTimer(resumeTime = 0) {
    if (gameTimerId) clearInterval(gameTimerId);

    startTime = Date.now() - (resumeTime * 1000); 
    elapsedTime = resumeTime;

    if (timerContainer) timerContainer.style.display = 'inline-flex';

    function updateDisplay() {
        elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        
        if (gameTimerEl) {
            gameTimerEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        // タイマー更新時（毎秒）の自動セーブ
        saveCurrentProgress();
    }

    updateDisplay();
    gameTimerId = setInterval(updateDisplay, 1000);
}

// 特定のパズルデータをFirestoreから1件取得
async function loadSpecificPuzzle(puzzleId, savedProgress = null) {
    console.log(`パズルID: ${puzzleId} をストレージからロードします...`);

    const savedPuzzle = savedProgress?.type === "sudoku" && savedProgress.id === puzzleId
        ? savedProgress
        : null;
    if (savedPuzzle?.problemData && savedPuzzle?.solutionData) {
        currentPuzzleId = puzzleId;
        displayPuzzle(savedPuzzle.problemData, savedPuzzle.solutionData);
        startGameTimer();
        return;
    }

    const puzzleData = await fetchPuzzleById(puzzleId);
    if (!puzzleData || puzzleData.type !== "sudoku") {
        throw new Error("指定されたパズルデータがFirestoreに存在しません。");
    }
    currentPuzzleId = puzzleId;
    currentDifficulty = puzzleData.difficulty || currentDifficulty;
    displayPuzzle(puzzleData.problemData, puzzleData.solutionData);
    startGameTimer();

    if (currentUser) {
        statusText.innerText = isAdmin
            ? `👑 管理者ログイン中: ${currentUser.displayName} (パズルID: ${currentPuzzleId})`
            : `ログイン中: ${currentUser.displayName} (パズルID: ${currentPuzzleId})`;
    }
}

// 現在の全セルの状態を配列として抽出する関数
function getNowBoardArray() {
    return cells.map(cell => {
        const val = cell.querySelector('.cell-val').innerText.trim();
        const isInitial = cell.classList.contains('initial');
        const isUserFilled = cell.classList.contains('user-filled');
        
        const memos = [];
        cell.querySelectorAll('.memo-grid span').forEach(span => {
            if (span.innerText.trim() !== '') {
                memos.push(span.dataset.num);
            }
        });

        return { val, isInitial, isUserFilled, memos };
    });
}

// セーブデータから盤面の状態を復元して描画する関数
function renderBoard(boardData) {
    if (!boardData || boardData.length !== 81) return;
    updateHighlight(null);

    boardData.forEach((data, i) => {
        const cell = cells[i];
        cell.className = 'cell'; 
        
        if (data.isInitial) cell.classList.add('initial');
        if (data.isUserFilled) cell.classList.add('user-filled');
        
        cell.querySelector('.cell-val').innerText = data.val;
        
        const memoSpans = cell.querySelectorAll('.memo-grid span');
        memoSpans.forEach(span => {
            const num = span.dataset.num;
            if (data.memos && data.memos.includes(num)) {
                span.innerText = num;
            } else {
                span.innerText = '';
            }
        });
    });
    updateNumberPadStatus();
}

// 進行状況をローカルストレージにセーブする関数
function saveCurrentProgress() {
    if (isChallenge || !currentPuzzleId || gameFinished) return;

    const progressData = {
        type: "sudoku",                  
        mode: playMode,
        difficulty: currentDifficulty,   
        id: currentPuzzleId,             
        board: getNowBoardArray(),       
        elapsedTime: elapsedTime,
        problemData: currentProblem,
        solutionData: currentSolution
    };

    saveProgress(progressData);
}

// パズルがクリアされたらセーブデータを消去する関数
function onPuzzleCleared() {
    clearProgress();
}

// 盤面の初期化 (9x9)
const boardElement = document.getElementById('board');
const cells = [];
for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.dataset.index = i;

    const cellVal = document.createElement('span');
    cellVal.classList.add('cell-val');
    cell.appendChild(cellVal);

    const memoGrid = document.createElement('div');
    memoGrid.classList.add('memo-grid');
    for (let m = 1; m <= 9; m++) {
        const span = document.createElement('span');
        span.dataset.num = m;
        memoGrid.appendChild(span);
    }
    cell.appendChild(memoGrid);

    cell.addEventListener('click', () => {
        if (guardFinished()) return;
        if (currentInputMode === 'auto') {
            if (cell.classList.contains('initial')) {
                updateHighlight(i);
                return;
            }
            if (selectedNumber !== null) {
                selectedCell = cell;
                handleInput(selectedNumber);
            } else {
                updateHighlight(i);
            }
        } else {
            updateHighlight(i);
        }
    });
    boardElement.appendChild(cell);
    cells.push(cell);
}

function renderMistakes() {
    cells.forEach((cell) => cell.classList.remove('highlight-error'));
    mistakeIndexes.forEach((idx) => cells[idx]?.classList.add('highlight-error'));
    mistakePanel.hidden = mistakeIndexes.size === 0;
    if (!mistakePanel.hidden) mistakeMessageEl.textContent = "消してやり直してみましょう。";
}

function showMistakes(indexes, message = mistakeMessage) {
    mistakeIndexes = new Set(indexes);
    mistakeMessage = message;
    renderMistakes();
}

function dismissMistakes() {
    mistakeIndexes.clear();
    cells.forEach((cell) => cell.classList.remove('highlight-error'));
    mistakePanel.hidden = true;
}

function refreshMistakesAfterInput() {
    if (!mistakeIndexes.size) return;
    mistakeIndexes = new Set([...mistakeIndexes].filter((idx) => {
        const cell = cells[idx];
        const value = cell.querySelector('.cell-val').innerText.trim();
        return !cell.classList.contains('initial') && value !== '' && value !== currentSolution[idx];
    }));
    renderMistakes();
}

function captureGameState() {
    return {
        board: getNowBoardArray(),
        mistakeIndexes: [...mistakeIndexes],
        mistakeMessage,
    };
}

function applyGameState(saved) {
    renderBoard(saved.board);
    mistakeIndexes = new Set(saved.mistakeIndexes || []);
    mistakeMessage = saved.mistakeMessage || mistakeMessage;
    renderMistakes();
    saveCurrentProgress();
}

const history = createUndoHistory({
    apply: applyGameState,
    onChange: ({ canUndo }) => { undoButton.disabled = !canUndo || gameFinished; },
});

function undo() {
    if (guardFinished()) return;
    if (history.undo()) {
        updateNumberPadStatus();
        checkAutoVerify();
    }
}

undoButton.addEventListener('click', undo);
bindUndoShortcut(document, undo);
document.getElementById('dismiss-mistakes-btn').addEventListener('click', dismissMistakes);
document.getElementById('clear-mistakes-btn').addEventListener('click', () => {
    if (!mistakeIndexes.size) return;
    const before = captureGameState();
    mistakeIndexes.forEach((idx) => {
        const cell = cells[idx];
        if (!cell || cell.classList.contains('initial')) return;
        cell.querySelector('.cell-val').innerText = '';
        cell.classList.remove('user-filled');
        cell.querySelectorAll('.memo-grid span').forEach((span) => { span.innerText = ''; });
    });
    dismissMistakes();
    history.record(before);
    updateNumberPadStatus();
    saveCurrentProgress();
});

// スマートハイライト制御関数
function updateHighlight(selectedIndex) {
    cells.forEach(cell => {
        cell.classList.remove(
            'highlight-selected', 'highlight-area', 'highlight-same',
            'highlight-hint-target', 'highlight-hint-area'
        );
    });

    if (hintTextArea) {
        hintTextArea.style.display = 'none';
        hintTextArea.innerText = '';
    }

    const hasSelection = selectedIndex !== null && selectedIndex !== undefined;
    selectedCell = hasSelection ? cells[selectedIndex] : null;
    if (selectedCell) selectedCell.classList.add('highlight-selected');

    const r = hasSelection ? Math.floor(selectedIndex / 9) : -1;
    const c = hasSelection ? selectedIndex % 9 : -1;
    const b = hasSelection ? Math.floor(r / 3) * 3 + Math.floor(c / 3) : -1;
    const targetNum = currentInputMode === 'auto' && selectedNumber !== null && selectedNumber !== ''
        ? String(selectedNumber)
        : selectedCell?.querySelector('.cell-val').innerText.trim() || '';

    cells.forEach((cell, i) => {
        const cellRow = Math.floor(i / 9);
        const cellCol = i % 9;
        const cellBlock = Math.floor(cellRow / 3) * 3 + Math.floor(cellCol / 3);

        if (hasSelection && i !== selectedIndex && (cellRow === r || cellCol === c || cellBlock === b)) {
            cell.classList.add('highlight-area');
        }

        if (targetNum !== '') {
            const currentNum = cell.querySelector('.cell-val').innerText.trim();
            if (currentNum === targetNum && i !== selectedIndex) {
                cell.classList.add('highlight-same');
            }
        }
    });
}

// 💡 入力・削除コアロジック
function handleInput(num) {
    if (guardFinished()) return;
    if (!selectedCell) return;
    if (selectedCell.classList.contains('initial')) return;

    const before = captureGameState();
    const beforeBoard = JSON.stringify(before.board);

    const cellVal = selectedCell.querySelector('.cell-val');
    const memoGrid = selectedCell.querySelector('.memo-grid');

    if (num === '') {
        // 削除（クリアボタンやBackspace）された時の処理
        cellVal.innerText = '';
        selectedCell.classList.remove('user-filled');
        memoGrid.querySelectorAll('span').forEach(span => span.innerText = '');
    } else {
        if (isMemoMode) {
            cellVal.innerText = '';
            selectedCell.classList.remove('user-filled');

            const memoSpan = memoGrid.querySelector(`span[data-num="${num}"]`);
            if (memoSpan) {
                memoSpan.innerText = memoSpan.innerText === num ? '' : num;
            }
        } else {
            cellVal.innerText = num;
            selectedCell.classList.add('user-filled');
            memoGrid.querySelectorAll('span').forEach(span => span.innerText = '');

            const selectedIndex = parseInt(selectedCell.dataset.index);
            const r = Math.floor(selectedIndex / 9);
            const c = selectedIndex % 9;
            const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

            cells.forEach((cell, i) => {
                if (i === selectedIndex) return;
                const cellRow = Math.floor(i / 9);
                const cellCol = i % 9;
                const cellBlock = Math.floor(cellRow / 3) * 3 + Math.floor(cellCol / 3);

                if (cellRow === r || cellCol === c || cellBlock === b) {
                    const targetMemoSpan = cell.querySelector(`.memo-grid span[data-num="${num}"]`);
                    if (targetMemoSpan) targetMemoSpan.innerText = '';
                }
            });
        }
    }
    
    const index = parseInt(selectedCell.dataset.index);
    updateHighlight(index);
    refreshMistakesAfterInput();
    updateNumberPadStatus();

    if (JSON.stringify(getNowBoardArray()) !== beforeBoard) history.record(before);
    
    // 💡 ①【確認・維持】入力、削除、メモ追加など「あらゆる変化」の直後に自動セーブを走らせます
    saveCurrentProgress();
    checkAutoVerify();
}

// 自動答え合わせ判定
function checkAutoVerify() {
    const currentBoardStr = cells.map(cell => cell.querySelector('.cell-val').innerText.trim() || '0').join('');
    if (!currentBoardStr.includes('0')) {
        setTimeout(() => { if (!gameFinished) executeCheck(true); }, 50);
    }
}

// 数字のボタン色同期
function updateNumberPadStatus() {
    const counts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 };
    cells.forEach(cell => {
        const num = cell.querySelector('.cell-val').innerText.trim();
        if (counts[num] !== undefined) counts[num]++;
    });

    for (let num = 1; num <= 9; num++) {
        const btn = document.querySelector(`.num-pad .num-btn[data-num="${num}"]`);
        if (btn) {
            if (counts[num] >= 9) {
                btn.classList.add('completed');
            } else {
                btn.classList.remove('completed');
            }
        }
    }
}

// 設置モード切り替えイベント
if (modeLocationBtn && modeAutoBtn) {
    modeLocationBtn.addEventListener('click', () => {
        if (guardFinished()) return;
        currentInputMode = 'location';
        modeLocationBtn.classList.add('active');
        modeAutoBtn.classList.remove('active');
        selectedNumber = null;
        document.querySelectorAll('.num-pad .num-btn').forEach(b => b.classList.remove('selected-num'));
        updateHighlight(selectedCell ? Number(selectedCell.dataset.index) : null);
    });

    modeAutoBtn.addEventListener('click', () => {
        if (guardFinished()) return;
        currentInputMode = 'auto';
        modeAutoBtn.classList.add('active');
        modeLocationBtn.classList.remove('active');
        updateHighlight(selectedCell ? Number(selectedCell.dataset.index) : null);
    });
}

// ナンバーパッドのクリックイベント
document.querySelectorAll('.num-pad .num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (guardFinished()) return;
        const num = btn.dataset.num;
        if (currentInputMode === 'auto') {
            document.querySelectorAll('.num-pad .num-btn').forEach(b => b.classList.remove('selected-num'));
            if (selectedNumber === num) {
                selectedNumber = null;
            } else {
                selectedNumber = num;
                btn.classList.add('selected-num');
            }
            updateHighlight(selectedCell ? Number(selectedCell.dataset.index) : null);
        } else {
            handleInput(num);
        }
    });
});

// キーボード入力イベント
document.addEventListener('keydown', (e) => {
    if (gameFinished && (e.key === ' ' || e.key.toLowerCase() === 'm' || (e.key >= '0' && e.key <= '9') || e.key === 'Backspace' || e.key === 'Delete' || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))) {
        e.preventDefault();
        guardFinished();
        return;
    }
    if (e.key === ' ' || e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (memoBtn) memoBtn.click();
        return;
    }

    if (!selectedCell) return;
    
    if (e.key >= '1' && e.key <= '9') {
        if (currentInputMode === 'auto') {
            selectedNumber = e.key;
            document.querySelectorAll('.num-pad .num-btn').forEach(b => b.classList.remove('selected-num'));
            const targetBtn = document.querySelector(`.num-pad .num-btn[data-num="${e.key}"]`);
            if (targetBtn) targetBtn.classList.add('selected-num');
            updateHighlight(Number(selectedCell.dataset.index));
        } else {
            handleInput(e.key);
        }
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        if (currentInputMode === 'auto') {
            selectedNumber = '';
            document.querySelectorAll('.num-pad .num-btn').forEach(b => b.classList.remove('selected-num'));
            const targetBtn = document.querySelector('.num-pad .clear-btn');
            if (targetBtn) targetBtn.classList.add('selected-num');
            updateHighlight(Number(selectedCell.dataset.index));
        } else {
            handleInput('');
        }
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        let index = parseInt(selectedCell.dataset.index);
        if (e.key === 'ArrowUp') index -= 9;
        if (e.key === 'ArrowDown') index += 9;
        if (e.key === 'ArrowLeft') index -= 1;
        if (e.key === 'ArrowRight') index += 1;

        if (index >= 0 && index < 81) {
            cells[index].click();
        }
    }
});

// 仮置きモード切替ボタン
if (memoBtn) {
    memoBtn.addEventListener('click', () => {
        if (guardFinished()) return;
        isMemoMode = !isMemoMode;
        if (isMemoMode) {
            memoBtn.classList.add('active');
            memoBtn.innerText = "仮置き: ON";
        } else {
            memoBtn.classList.remove('active');
            memoBtn.innerText = "仮置き: OFF";
        }
    });
}

// 盤面描画の補助関数
function displayPuzzle(boardStr, solutionStr) {
    gameFinished = false;
    completionState = null;
    dismissMistakes();
    history.clear();
    updateHighlight(null);
    currentSolution = solutionStr;
    currentProblem = boardStr;

    for (let i = 0; i < 81; i++) {
        const char = boardStr[i];
        cells[i].className = 'cell';
        const cellVal = cells[i].querySelector('.cell-val');
        const memoGrid = cells[i].querySelector('.memo-grid');
        memoGrid.querySelectorAll('span').forEach(span => span.innerText = '');
        
        if (char !== '0') {
            cellVal.innerText = char;
            cells[i].classList.add('initial');
        } else {
            cellVal.innerText = '';
        }
    }
    updateNumberPadStatus();
}

// 💡 答え合わせ・クリア処理
async function executeCheck(isAuto = false) {
    if (guardFinished()) return;
    const currentBoardStr = cells.map(cell => cell.querySelector('.cell-val').innerText.trim() || '0').join('');
    
    if (!isAuto && currentBoardStr.includes('0')) {
        alert("⚠️ まだ空いているマスがあります！すべて埋めてから答え合わせをしてください。");
        return;
    }

    if (currentBoardStr === currentSolution) {
        gameFinished = true;
        completionState = 'cleared';
        if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
        // タイマー停止
        clearInterval(gameTimerId); 
        
        // 💡 ②【実装】正解したので途中セーブデータを削除
        onPuzzleCleared(); 
        history.clear();
        
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        alert(`🎉 おめでとうございます！正解です！！\n⏱️ クリアタイム: ${minutes}分${seconds}秒`);
        hintTextArea.innerText = `🎉 クリア！ ${minutes}分${seconds}秒で完成しました。`;
        hintTextArea.style.display = 'block';
        
        if (currentPuzzleId) {
            try {
                const uid = currentUser ? currentUser.uid : null;
                // Firestoreへ実績保存
                await saveClearRecord(uid, currentPuzzleId, elapsedTime, {
                    type: "sudoku", difficulty: currentDifficulty, size: 9, mode: playMode,
                });
                console.log(`クリア実績を記録しました。 (PuzzleID: ${currentPuzzleId})`);
            } catch (e) {
                console.error("クリア実績の保存に失敗:", e);
            }
        }

    } else {
        alert("❌ 残念！どこかが間違っています。もう一度見端を見直してみましょう。");
    }
}

// イベントの紐付け
document.getElementById('check-btn').addEventListener('click', () => executeCheck(false));
document.getElementById('hint-btn').addEventListener('click', () => {
    if (guardFinished()) return;
    const result = executeHintLogic(currentSolution, cells, hintTextArea);
    if (result?.kind === 'mistake') showMistakes(result.indexes, result.message);
    else dismissMistakes();
});

async function forfeitChallenge(destination = "../index.html") {
    if (gameFinished) {
        window.location.href = destination;
        return;
    }
    if (!confirm("チャレンジを途中棄権しますか？\nこのプレイは終了済みとして記録され、続きから再開できません。")) return;
    gameFinished = true;
    completionState = 'abandoned';
    if (challengeSessionKey) sessionStorage.removeItem(challengeSessionKey);
    clearInterval(gameTimerId);
    clearProgress();
    history.clear();
    dismissMistakes();
    try {
        await markPuzzleFinished(currentUser?.uid || auth.currentUser?.uid || null, currentPuzzleId, "abandoned", {
            type: "sudoku", difficulty: currentDifficulty, size: 9, elapsedTime, mode: playMode,
        });
    } catch (error) {
        console.error("途中棄権の記録に失敗しました:", error);
    }
    window.location.href = destination;
}

document.getElementById('giveup-btn').addEventListener('click', async () => {
    if (guardFinished()) return;
    if (isChallenge) {
        await forfeitChallenge();
        return;
    }
    if (!currentSolution) {
        alert("解答データが読み込まれていません。");
        return;
    }

    if (confirm("本当に諦めますか？すべてのマスに模範解答が配置されます。")) {
        gameFinished = true;
        completionState = 'answer-revealed';
        clearInterval(gameTimerId); 
        clearProgress();
        history.clear();
        dismissMistakes();
        cells.forEach((cell, i) => {
            if (cell.classList.contains('initial')) return;
            const cellVal = cell.querySelector('.cell-val');
            const memoGrid = cell.querySelector('.memo-grid');
            cellVal.innerText = currentSolution[i];
            cell.classList.add('user-filled');
            memoGrid.querySelectorAll('span').forEach(span => span.innerText = '');
        });
        updateHighlight(null);
        updateNumberPadStatus();
        try {
            await markPuzzleFinished(currentUser?.uid || auth.currentUser?.uid || null, currentPuzzleId, "answer-revealed", {
                type: "sudoku", difficulty: currentDifficulty, size: 9, elapsedTime, mode: playMode,
            });
            alert("盤面に模範解答を反映し、この問題を終了済みとして記録しました。");
        } catch (error) {
            console.error("終了記録の保存に失敗しました:", error);
            alert(`盤面に模範解答を反映しましたが、終了記録を保存できませんでした。\n${error.code || error.message || "unknown"}`);
        }
    }
});

document.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', (event) => {
        if (!isChallenge || gameFinished) return;
        event.preventDefault();
        void forfeitChallenge(link.href);
    });
});

window.addEventListener('beforeunload', (event) => {
    if (!isChallenge || gameFinished) return;
    event.preventDefault();
    event.returnValue = '';
});
