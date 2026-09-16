// エリアハイライト補助
function highlightHintArea(r, c, targetIdx, cells) {
    const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    cells.forEach((cell, i) => {
        const cellRow = Math.floor(i / 9);
        const cellCol = i % 9;
        const cellBlock = Math.floor(cellRow / 3) * 3 + Math.floor(cellCol / 3);

        if (i === targetIdx) {
            cell.classList.add('highlight-hint-target');
        } else if (cellRow === r || cellCol === c || cellBlock === b) {
            cell.classList.add('highlight-hint-area');
        }
    });
}

// ヒントシステム本体
export function executeHintLogic(currentSolution, cells, hintTextArea) {
    if (!currentSolution) {
        alert("解答データが読み込まれていません。");
        return { kind: 'unavailable', indexes: [] };
    }

    hintTextArea.style.display = 'block';
    hintTextArea.style.backgroundColor = '#f0f0f0';
    hintTextArea.style.color = '#333';
    hintTextArea.innerText = ""; 

    cells.forEach(cell => {
        cell.classList.remove('highlight-error', 'highlight-hint-target', 'highlight-hint-area');
    });

    const currentBoardStr = cells.map(cell => cell.querySelector('.cell-val').innerText.trim() || '0').join('');
    const board = [];
    for (let i = 0; i < 81; i += 9) {
        board.push(currentBoardStr.slice(i, i + 9).split('').map(Number));
    }

    // ① 重複チェック
    let conflictIndexes = new Set();
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const val = board[r][c];
            if (val === 0) continue;
            const idx = r * 9 + c;
            for (let i = 0; i < 9; i++) {
                if (i !== c && board[r][i] === val) { conflictIndexes.add(idx); conflictIndexes.add(r * 9 + i); }
            }
            for (let i = 0; i < 9; i++) {
                if (i !== r && board[i][c] === val) { conflictIndexes.add(idx); conflictIndexes.add(i * 9 + c); }
            }
            const br = Math.floor(r / 3) * 3;
            const bc = Math.floor(c / 3) * 3;
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    const tr = br + i;
                    const tc = bc + j;
                    if ((tr !== r || tc !== c) && board[tr][tc] === val) {
                        conflictIndexes.add(idx);
                        conflictIndexes.add(tr * 9 + tc);
                    }
                }
            }
        }
    }

    if (conflictIndexes.size > 0) {
        const editableWrong = [...conflictIndexes].filter((idx) => {
            const value = cells[idx].querySelector('.cell-val').innerText.trim();
            return !cells[idx].classList.contains('initial') && value && value !== currentSolution[idx];
        });
        if (editableWrong.length) {
            editableWrong.forEach(idx => cells[idx].classList.add('highlight-error'));
            hintTextArea.style.display = 'none';
            return {
                kind: 'mistake',
                indexes: editableWrong,
                message: "❌ この数字は間違えています。消してやり直してみましょう。",
            };
        }
    }

    // ② 誤答チェック
    let wrongIndexes = [];
    for (let i = 0; i < 81; i++) {
        if (!cells[i].classList.contains('initial')) {
            const userVal = cells[i].querySelector('.cell-val').innerText.trim();
            if (userVal !== '' && userVal !== currentSolution[i]) {
                wrongIndexes.push(i);
            }
        }
    }

    if (wrongIndexes.length > 0) {
        wrongIndexes.forEach(idx => cells[idx].classList.add('highlight-error'));
        hintTextArea.style.display = 'none';
        return {
            kind: 'mistake',
            indexes: wrongIndexes,
            message: "❌ この数字は間違えています。消してやり直してみましょう。",
        };
    }

    // ③ 各マスの候補数字を算出
    let candidates = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set([1,2,3,4,5,6,7,8,9])));
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] !== 0) {
                candidates[r][c].clear();
                continue;
            }
            for (let i = 0; i < 9; i++) {
                candidates[r][c].delete(board[r][i]);
                candidates[r][c].delete(board[i][c]);
            }
            const br = Math.floor(r / 3) * 3;
            const bc = Math.floor(c / 3) * 3;
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    candidates[r][c].delete(board[br + i][bc + j]);
                }
            }
        }
    }

    // 💡 Naked Single
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] === 0 && candidates[r][c].size === 1) {
                const targetIdx = r * 9 + c;
                const answerNum = Array.from(candidates[r][c])[0];
                highlightHintArea(r, c, targetIdx, cells);
                hintTextArea.style.backgroundColor = '#d4edda';
                hintTextArea.style.color = '#155724';
                hintTextArea.innerHTML = `💡 <strong>Naked Single (単一候補)</strong><br>緑色のマスに注目してください。このマスに関連する縦・横・ブロックの数字をすべて除外していくと、残る数字は <strong>「${answerNum}」</strong> だけになります！`;
                return;
            }
        }
    }

    // 💡 Hidden Single
    for (let b = 0; b < 9; b++) {
        const br = Math.floor(b / 3) * 3;
        const bc = (b % 3) * 3;
        for (let num = 1; num <= 9; num++) {
            let count = 0;
            let targetR = -1, targetC = -1;
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    const r = br + i;
                    const c = bc + j;
                    if (board[r][c] === 0 && candidates[r][c].has(num)) {
                        count++;
                        targetR = r; targetC = c;
                    }
                }
            }
            if (count === 1) {
                const targetIdx = targetR * 9 + targetC;
                highlightHintArea(targetR, targetC, targetIdx, cells);
                hintTextArea.style.backgroundColor = '#d4edda';
                hintTextArea.style.color = '#155724';
                hintTextArea.innerHTML = `💡 <strong>Hidden Single (隠れた単一)</strong><br>ハイライトされたブロックを見てください。このブロックの中で、数字の <strong>「${num}」</strong> が入れる場所は、緑色のマスしか残されていません！`;
                return;
            }
        }
    }

    // 💡 Naked Pair
    for (let r = 0; r < 9; r++) {
        for (let c1 = 0; c1 < 9; c1++) {
            if (board[r][c1] === 0 && candidates[r][c1].size === 2) {
                for (let c2 = c1 + 1; c2 < 9; c2++) {
                    if (board[r][c2] === 0 && candidates[r][c2].size === 2) {
                        const arr1 = Array.from(candidates[r][c1]);
                        if (candidates[r][c2].has(arr1[0]) && candidates[r][c2].has(arr1[1])) {
                            cells[r * 9 + c1].classList.add('highlight-hint-target');
                            cells[r * 9 + c2].classList.add('highlight-hint-target');
                            for(let i=0; i<9; i++) {
                                if(i !== c1 && i !== c2) cells[r * 9 + i].classList.add('highlight-hint-area');
                            }
                            hintTextArea.style.backgroundColor = '#cee3ff';
                            hintTextArea.style.color = '#004085';
                            hintTextArea.innerHTML = `💡 <strong>Naked Pair (二国同盟)</strong><br>同じ行にある2つの緑色のマスに注目してください。どちらのマスにも <strong>「${arr1[0]}」か「${arr1[1]}」</strong> の2つしか入りません。つまり、この行の他のマス（グレー部分）から、この2つの数字を候補から消去できます！`;
                            return;
                        }
                    }
                }
            }
        }
    }

    // 💡 救済措置
    for (let i = 0; i < 81; i++) {
        if (currentBoardStr[i] === '0') {
            cells[i].classList.add('highlight-hint-target');
            hintTextArea.style.backgroundColor = '#fff3cd';
            hintTextArea.style.color = '#856404';
            hintTextArea.innerHTML = `💡 <strong>高度なロジック / 仮定法が必要な局面</strong><br>現在、非常に複雑な盤面になっています。緑色のマスの正しい答えは <strong>「${currentSolution[i]}」</strong> です。ここを突破口にしてみましょう！`;
            return;
        }
    }
}
