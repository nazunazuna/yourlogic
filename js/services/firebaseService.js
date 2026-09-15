import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, arrayUnion, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkbdX-B6FfIVplmG98tIvxO0uUv-mYDSw",
  authDomain: "yourlogic-c0b64.firebaseapp.com",
  projectId: "yourlogic-c0b64",
  storageBucket: "yourlogic-c0b64.firebasestorage.app",
  messagingSenderId: "774656497074",
  appId: "1:774656497074:web:07d6d6092d5d176224c0ab",
  measurementId: "G-W4VM6FC3J5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

/**
 * ユーザーデータの取得（なければスタミナ5で初期化）
 */
export async function fetchOrInitUser(user) {
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (!userDoc.exists()) {
        const initialData = { 
            generationPoints: 5, 
            lastPointUpdatedAt: new Date(), 
            clearedPuzzles: [], 
            records: {},
            clearHistory: [],
            isAdmin: false 
        };
        await setDoc(userDocRef, initialData);
        return initialData;
    }
    return userDoc.data();
}

/**
 * 難易度に応じたパズルストックの取得
 */
export async function fetchPuzzlesByDifficulty(difficulty) {
    const q = query(
        collection(db, "puzzles"),
        where("type", "==", "sudoku"),
        where("difficulty", "==", difficulty)
    );
    const querySnapshot = await getDocs(q);
    const puzzles = [];
    querySnapshot.forEach((doc) => {
        puzzles.push({ id: doc.id, ...doc.data() });
    });
    return puzzles;
}

/**
 * 新規生成パズルをDBに保存
 */
export async function saveNewPuzzle(uid, difficulty, puzzleData) {
    const docRef = await addDoc(collection(db, "puzzles"), {
        type: "sudoku",
        difficulty: difficulty,
        problemData: puzzleData.problemData,
        solutionData: puzzleData.solutionData,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/**
 * ユーザーの生成猶予（スタミナ）を更新する関数
 */
export async function updateUserStamina(uid, points, updatedAt) {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, {
        generationPoints: points,
        lastPointUpdatedAt: updatedAt
    });
}

/**
 * 💡 クリア実績の保存（ログイン/ゲスト 自動振り分け・タイム記録対応版）
 */
export async function saveClearRecord(uid, puzzleId, elapsedTime = 0, metadata = {}) {
    const record = {
        puzzleId,
        type: metadata.type || "sudoku",
        difficulty: metadata.difficulty || "unknown",
        size: metadata.size || null,
        elapsedTime,
        clearedAt: new Date().toISOString()
    };
    if (uid) {
        // ログインユーザー：Firestoreに書き込み
        const userRef = doc(db, "users", uid);
        try {
            await updateDoc(userRef, {
                clearedPuzzles: arrayUnion(puzzleId),
                [`records.${puzzleId}`]: elapsedTime,
                clearHistory: arrayUnion(record)
            });
        } catch (error) {
            // ドキュメントが存在しないケースを想定したフォールバック
            await setDoc(userRef, {
                clearedPuzzles: [puzzleId],
                records: { [puzzleId]: elapsedTime },
                clearHistory: [record]
            }, { merge: true });
        }
    } else {
        // ゲストユーザー：LocalStorageに保存
        let guestCleared = JSON.parse(localStorage.getItem('guest_cleared_puzzles')) || [];
        if (!guestCleared.includes(puzzleId)) {
            guestCleared.push(puzzleId);
            localStorage.setItem('guest_cleared_puzzles', JSON.stringify(guestCleared));
        }
        
        let guestTimes = JSON.parse(localStorage.getItem('guest_clear_times')) || {};
        guestTimes[puzzleId] = elapsedTime;
        localStorage.setItem('guest_clear_times', JSON.stringify(guestTimes));

        const history = JSON.parse(localStorage.getItem('guest_clear_history') || '[]');
        history.push(record);
        localStorage.setItem('guest_clear_history', JSON.stringify(history.slice(-100)));
    }
}

/**
 * 💡 ログイン時にゲストデータをアカウントにマージ（紐付け）する関数
 */
export async function mergeGuestData(uid) {
    const guestCleared = JSON.parse(localStorage.getItem('guest_cleared_puzzles')) || [];
    const guestTimes = JSON.parse(localStorage.getItem('guest_clear_times')) || {};
    const guestHistory = JSON.parse(localStorage.getItem('guest_clear_history') || '[]');

    // 移行するデータが何もなければスキップ
    if (guestCleared.length === 0) return;

    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    let currentCleared = [];
    let currentRecords = {};
    let currentHistory = [];

    if (userSnap.exists()) {
        const userData = userSnap.data();
        currentCleared = userData.clearedPuzzles || [];
        currentRecords = userData.records || {};
        currentHistory = userData.clearHistory || [];
    }

    // 重複を弾きつつ、既存のアカウントデータとマージ
    const newCleared = Array.from(new Set([...currentCleared, ...guestCleared]));
    const newRecords = { ...currentRecords, ...guestTimes };

    // Firestoreを更新
    await setDoc(userRef, {
        clearedPuzzles: newCleared,
        records: newRecords,
        clearHistory: [...currentHistory, ...guestHistory].slice(-500)
    }, { merge: true });

    // 移行が完了したため、LocalStorageのゲストデータをクリーンアップ
    localStorage.removeItem('guest_cleared_puzzles');
    localStorage.removeItem('guest_clear_times');
    localStorage.removeItem('guest_clear_history');
    console.log("🎉 ゲストユーザー時のプレイ状況をアカウントへ正常に紐付けました。");
}

/**
 * 💡 ユーザーが登録済み（Firestoreにドキュメントがあるか）だけをチェックする関数
 */
export async function checkUserExists(uid) {
    const userDocRef = doc(db, "users", uid);
    const userDoc = await getDoc(userDocRef);
    return userDoc.exists();
}

/**
 * 💡 新規ユーザー用のドキュメントを表示名付きで作成する関数
 */
export async function registerNewUser(uid, displayName) {
    const userDocRef = doc(db, "users", uid);
    const initialData = { 
        displayName: displayName,
        generationPoints: 5, 
        lastPointUpdatedAt: new Date(), 
        clearedPuzzles: [], 
        records: {},
        clearHistory: [],
        isAdmin: false 
    };
    await setDoc(userDocRef, initialData);
    return initialData;
}
