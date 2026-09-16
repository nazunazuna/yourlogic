function sameRect(a, b) {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

function overlaps(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

function rectArea(rect) {
  return (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
}

function rectCells(rect, size) {
  const result = [];
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) result.push(y * size + x);
  }
  return result;
}

function cellPoint(index, size) {
  return { x: index % size, y: Math.floor(index / size) };
}

function cluesInRect(rect, clues) {
  return clues.filter((clue) => (
    clue.x >= rect.x1 && clue.x <= rect.x2 && clue.y >= rect.y1 && clue.y <= rect.y2
  ));
}

function collectClues(board) {
  const clues = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      if (Number(board[y][x]) > 0) clues.push({ id: clues.length, x, y, value: Number(board[y][x]) });
    }
  }
  return clues;
}

function parseDraftPoint(value, size) {
  const [x, y] = String(value).split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) return null;
  return y * size + x;
}

function buildMemoKnowledge(draftEdges, size, clues) {
  const parent = Int32Array.from({ length: size * size }, (_, index) => index);
  const active = new Set();
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  (Array.isArray(draftEdges) ? draftEdges : [...(draftEdges || [])]).forEach((edge) => {
    const [leftValue, rightValue] = String(edge).split("|");
    const left = parseDraftPoint(leftValue, size);
    const right = parseDraftPoint(rightValue, size);
    if (left === null || right === null) return;
    active.add(left);
    active.add(right);
    unite(left, right);
  });

  const componentsByRoot = new Map();
  active.forEach((cell) => {
    const root = find(cell);
    if (!componentsByRoot.has(root)) componentsByRoot.set(root, new Set());
    componentsByRoot.get(root).add(cell);
  });
  const components = [...componentsByRoot.values()].map((cells) => {
    const componentClues = clues.filter((clue) => cells.has(clue.y * size + clue.x));
    return { cells, clueId: componentClues.length === 1 ? componentClues[0].id : null, clues: componentClues };
  });
  const conflicting = components.find((component) => component.clues.length > 1);
  if (conflicting) {
    return {
      components,
      recordedByClue: new Map(),
      error: {
        tone: "error",
        cells: [...conflicting.cells].map((cell) => cellPoint(cell, size)),
        message: "同じ領域を示すメモ線が複数の数字をつないでいます。1つの長方形には数字を1つだけ入れてください。",
      },
    };
  }
  const oversized = components.find((component) => (
    component.clueId !== null && component.cells.size > clues[component.clueId].value
  ));
  if (oversized) {
    const clue = clues[oversized.clueId];
    return {
      components,
      recordedByClue: new Map(),
      error: {
        tone: "error",
        cells: [...oversized.cells].map((cell) => cellPoint(cell, size)),
        number: clue,
        message: `メモで結んだマス数が「${clue.value}」の面積を超えています。メモ線を見直してください。`,
      },
    };
  }
  const recordedByClue = new Map();
  components.forEach((component) => {
    if (component.clueId !== null) recordedByClue.set(component.clueId, component.cells);
  });
  return { components, recordedByClue, error: null };
}

function candidateHonorsMemo(candidate, clueIndex, memo) {
  return memo.components.every((component) => {
    let contained = 0;
    component.cells.forEach((cell) => { if (candidate.cells.includes(cell)) contained++; });
    if (component.clueId !== null) {
      return clueIndex === component.clueId
        ? contained === component.cells.size
        : contained === 0;
    }
    return contained === 0 || contained === component.cells.size;
  });
}

function enumerateCandidates(board, clues) {
  const size = board.length;
  return clues.map((clue) => {
    const candidates = [];
    for (let height = 1; height <= clue.value; height++) {
      if (clue.value % height !== 0) continue;
      const width = clue.value / height;
      if (width > size || height > size) continue;
      const minX = Math.max(0, clue.x - width + 1);
      const maxX = Math.min(clue.x, size - width);
      const minY = Math.max(0, clue.y - height + 1);
      const maxY = Math.min(clue.y, size - height);
      for (let y1 = minY; y1 <= maxY; y1++) {
        for (let x1 = minX; x1 <= maxX; x1++) {
          const rect = { x1, y1, x2: x1 + width - 1, y2: y1 + height - 1 };
          if (cluesInRect(rect, clues).length !== 1) continue;
          candidates.push({ ...rect, cells: rectCells(rect, size) });
        }
      }
    }
    return candidates;
  });
}

function commonCellIndexes(candidates) {
  if (!candidates.length) return [];
  const common = new Set(candidates[0].cells);
  for (let index = 1; index < candidates.length && common.size; index++) {
    const next = new Set(candidates[index].cells);
    common.forEach((cell) => { if (!next.has(cell)) common.delete(cell); });
  }
  return [...common];
}

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

// 正解データは使わず、「各数字から候補を1つ選び、重ならずに全マスを覆えるか」を検査します。
function hasCompletion(candidatesByClue, size, options = {}) {
  const deadline = options.deadline ?? now() + 350;
  const maxNodes = options.maxNodes ?? 120000;
  const assigned = new Uint8Array(candidatesByClue.length);
  const occupied = new Uint8Array(size * size);
  let occupiedCount = 0;
  let nodes = 0;

  function place(candidate) {
    for (const cell of candidate.cells) if (occupied[cell]) return false;
    candidate.cells.forEach((cell) => { occupied[cell] = 1; });
    occupiedCount += candidate.cells.length;
    return true;
  }

  function remove(candidate) {
    candidate.cells.forEach((cell) => { occupied[cell] = 0; });
    occupiedCount -= candidate.cells.length;
  }

  if (options.forced) {
    const { clueIndex, candidate } = options.forced;
    if (!place(candidate)) return false;
    assigned[clueIndex] = 1;
  }

  function search(remaining) {
    if (remaining === 0) return occupiedCount === size * size;
    nodes++;
    if (nodes > maxNodes || ((nodes & 127) === 0 && now() > deadline)) return null;

    let selectedClue = -1;
    let selectedCandidates = null;
    for (let clueIndex = 0; clueIndex < candidatesByClue.length; clueIndex++) {
      if (assigned[clueIndex]) continue;
      const viable = candidatesByClue[clueIndex].filter((candidate) => (
        candidate.cells.every((cell) => !occupied[cell])
      ));
      if (!viable.length) return false;
      if (!selectedCandidates || viable.length < selectedCandidates.length) {
        selectedClue = clueIndex;
        selectedCandidates = viable;
        if (viable.length === 1) break;
      }
    }

    assigned[selectedClue] = 1;
    let unknown = false;
    for (const candidate of selectedCandidates) {
      if (!place(candidate)) continue;
      const result = search(remaining - 1);
      remove(candidate);
      if (result === true) {
        assigned[selectedClue] = 0;
        return true;
      }
      if (result === null) unknown = true;
    }
    assigned[selectedClue] = 0;
    return unknown ? null : false;
  }

  return search(candidatesByClue.length - (options.forced ? 1 : 0));
}

function validateUserRects(userRects, board, clues) {
  const size = board.length;
  for (let index = 0; index < userRects.length; index++) {
    const rect = userRects[index];
    if (rect.x1 < 0 || rect.y1 < 0 || rect.x2 >= size || rect.y2 >= size) {
      return { rect, message: "盤面の外にはみ出している枠があります。赤い範囲を引き直してください。" };
    }
    const numbers = cluesInRect(rect, clues);
    if (numbers.length !== 1) {
      return { rect, message: "数字が1つだけ入るように、赤い範囲を引き直してみましょう。" };
    }
    const area = rectArea(rect);
    if (numbers[0].value !== area) {
      return { rect, message: `この範囲の面積は ${area} です。数字の ${numbers[0].value} と一致する大きさに直しましょう。` };
    }
    for (let other = 0; other < index; other++) {
      if (overlaps(rect, userRects[other])) {
        return { rect, message: "枠が重なっています。各マスが1つの長方形だけに入るように直しましょう。" };
      }
    }
  }
  return null;
}

function logicalHint(userRects, board, draftEdges = []) {
  const size = board.length;
  const clues = collectClues(board);
  const validationError = validateUserRects(userRects, board, clues);
  if (validationError) return { tone: "error", ...validationError };
  const memo = buildMemoKnowledge(draftEdges, size, clues);
  if (memo.error) return memo.error;

  const fixedByClue = new Map();
  userRects.forEach((rect) => {
    const clue = cluesInRect(rect, clues)[0];
    fixedByClue.set(clue.id, rect);
  });

  if (fixedByClue.size === clues.length) {
    return { tone: "success", message: "すべての領域がルールどおりに完成しています。答え合わせを押してみましょう。" };
  }

  const allCandidates = enumerateCandidates(board, clues);
  const candidatesByClue = allCandidates.map((candidates, clueIndex) => {
    const fixed = fixedByClue.get(clueIndex);
    if (fixed) return candidates.filter((candidate) => sameRect(candidate, fixed) && candidateHonorsMemo(candidate, clueIndex, memo));
    return candidates.filter((candidate) => (
      [...fixedByClue.values()].every((fixedRect) => !overlaps(candidate, fixedRect))
      && candidateHonorsMemo(candidate, clueIndex, memo)
    ));
  });

  const impossibleClue = clues.find((clue) => candidatesByClue[clue.id].length === 0);
  if (impossibleClue) {
    return {
      tone: "error",
      number: impossibleClue,
      message: `${impossibleClue.y + 1}行${impossibleClue.x + 1}列の「${impossibleClue.value}」を作れる場所が残っていません。入力済みの枠またはメモを見直してください。`,
    };
  }

  if (userRects.length || memo.components.length) {
    const feasibility = hasCompletion(candidatesByClue, size, { deadline: now() + 300, maxNodes: 70000 });
    if (feasibility === false) {
      return {
        tone: "error",
        cells: userRects.flatMap((rect) => rectCells(rect, size).map((cell) => cellPoint(cell, size))),
        message: "入力済みの枠とメモの組合せでは盤面全体を分割できません。赤い範囲の入力を見直してみましょう。",
      };
    }
  }

  for (const clue of clues) {
    if (fixedByClue.has(clue.id)) continue;
    const candidates = candidatesByClue[clue.id];
    if (candidates.length === 1) {
      const rect = candidates[0];
      const recorded = memo.recordedByClue.get(clue.id) || new Set();
      if (rect.cells.every((cell) => recorded.has(cell))) continue;
      return {
        tone: "hint",
        logicName: "候補が1つ",
        rect,
        number: clue,
        message: `${clue.y + 1}行${clue.x + 1}列の「${clue.value}」は、他の数字や確定済みの枠を避けると黄色の長方形にしかできません。`,
      };
    }
  }

  for (const clue of clues) {
    if (fixedByClue.has(clue.id)) continue;
    const recorded = memo.recordedByClue.get(clue.id) || new Set();
    const common = commonCellIndexes(candidatesByClue[clue.id])
      .filter((cell) => cell !== clue.y * size + clue.x && !recorded.has(cell));
    if (common.length) {
      return {
        tone: "hint",
        logicName: "全候補の共通マス",
        cells: common.map((cell) => cellPoint(cell, size)),
        number: clue,
        message: `${clue.y + 1}行${clue.x + 1}列の「${clue.value}」から作れる全候補に共通するマスです。黄色のマスはこの数字の領域だと確定します。`,
      };
    }
  }

  const fixedCells = new Set(userRects.flatMap((rect) => rectCells(rect, size)));
  const ownersByCell = Array.from({ length: size * size }, () => new Set());
  candidatesByClue.forEach((candidates, clueIndex) => {
    if (fixedByClue.has(clueIndex)) return;
    candidates.forEach((candidate) => candidate.cells.forEach((cell) => {
      if (!fixedCells.has(cell)) ownersByCell[cell].add(clueIndex);
    }));
  });
  const exclusiveByClue = new Map();
  ownersByCell.forEach((owners, cell) => {
    if (fixedCells.has(cell) || owners.size !== 1) return;
    const clueIndex = [...owners][0];
    const clue = clues[clueIndex];
    if (cell === clue.y * size + clue.x) return;
    if (!exclusiveByClue.has(clueIndex)) exclusiveByClue.set(clueIndex, []);
    exclusiveByClue.get(clueIndex).push(cell);
  });
  if (exclusiveByClue.size) {
    const available = [...exclusiveByClue.entries()].map(([clueIndex, cells]) => {
      const recorded = memo.recordedByClue.get(clueIndex) || new Set();
      return [clueIndex, cells.filter((cell) => !recorded.has(cell))];
    }).filter(([, cells]) => cells.length);
    const bestAvailable = available.sort((a, b) => b[1].length - a[1].length)[0];
    if (bestAvailable) {
      const [clueIndex, forcedCells] = bestAvailable;
      const clue = clues[clueIndex];
      return {
        tone: "hint",
        logicName: "その数字だけが届くマス",
        cells: forcedCells.map((cell) => cellPoint(cell, size)),
        number: clue,
        message: `黄色のマスを覆える候補は、${clue.y + 1}行${clue.x + 1}列の「${clue.value}」から作る長方形だけです。この数字の領域に入ると確定します。`,
      };
    }
  }

  const unresolved = clues
    .filter((clue) => !fixedByClue.has(clue.id))
    .sort((a, b) => candidatesByClue[a.id].length - candidatesByClue[b.id].length);
  const deadline = now() + 900;
  for (const clue of unresolved.slice(0, 4)) {
    const candidates = candidatesByClue[clue.id];
    if (candidates.length > 18) continue;
    const feasible = [];
    let unknown = false;
    for (const candidate of candidates) {
      const result = hasCompletion(candidatesByClue, size, {
        forced: { clueIndex: clue.id, candidate },
        deadline,
        maxNodes: 160000,
      });
      if (result === true) feasible.push(candidate);
      if (result === null) unknown = true;
      if (now() > deadline) { unknown = true; break; }
    }
    if (!unknown && feasible.length === 1) {
      const recorded = memo.recordedByClue.get(clue.id) || new Set();
      if (feasible[0].cells.every((cell) => recorded.has(cell))) continue;
      return {
        tone: "hint",
        logicName: "候補の仮定と矛盾",
        rect: feasible[0],
        number: clue,
        message: `${clue.y + 1}行${clue.x + 1}列の「${clue.value}」の候補を盤面全体で検証すると、黄色の長方形だけが矛盾なく全マスを分割できます。`,
      };
    }
    if (!unknown && feasible.length > 1) {
      const recorded = memo.recordedByClue.get(clue.id) || new Set();
      const common = commonCellIndexes(feasible)
        .filter((cell) => cell !== clue.y * size + clue.x && !recorded.has(cell));
      if (common.length) {
        return {
          tone: "hint",
          logicName: "盤面全体での候補絞り込み",
          cells: common.map((cell) => cellPoint(cell, size)),
          number: clue,
          message: `${clue.y + 1}行${clue.x + 1}列の「${clue.value}」の候補を盤面全体で絞ると、黄色のマスはどの候補にも共通します。`,
        };
      }
    }
  }

  const focus = unresolved[0];
  return {
    tone: "info",
    logicName: "候補数の比較",
    number: focus,
    message: focus
      ? `${focus.y + 1}行${focus.x + 1}列の「${focus.value}」は候補が ${candidatesByClue[focus.id].length} 通りあります。現時点では短時間で確定できるマスが見つからないため、周囲の数字から枠を増やしてみましょう。`
      : "現時点では確定できるマスが見つかりません。入力済みの枠を見直してみましょう。",
  };
}

function toTwoStageHint(hint) {
  if (!hint || ["error", "success"].includes(hint.tone)) return hint;
  const focusCells = hint.number
    ? [{ x: hint.number.x, y: hint.number.y }]
    : (hint.cells || []).slice(0, 1);
  const focusMessage = hint.number
    ? `${hint.number.y + 1}行${hint.number.x + 1}列の「${hint.number.value}」と、その周囲の未確定マスに注目してください。`
    : "ハイライトした未確定マスと、そこまで届く数字に注目してください。";
  return { ...hint, focusCells, focusMessage };
}

/** 第3引数の draftEdges だけを参照し、保存済みの解答データは一切使用しません。 */
export function getShikakuHint(userRects, board, options = {}) {
  if (!Array.isArray(board) || !board.length || board.some((row) => !Array.isArray(row) || row.length !== board.length)) {
    return { tone: "error", message: "盤面データを読み取れませんでした。" };
  }
  const draftEdges = !Array.isArray(options) && options?.draftEdges ? options.draftEdges : [];
  return toTwoStageHint(logicalHint(userRects || [], board, draftEdges));
}

export function enumerateShikakuCandidates(board, clues = collectClues(board)) {
  return enumerateCandidates(board, clues);
}

/**
 * すでに確定した枠を避けた結果、候補が1つだけになった数字を順に確定します。
 * 保存済みの解答は受け取らず、盤面の数字と現在の枠だけを使います。
 */
export function completeForcedShikakuRectangles(board, initialRects = []) {
  if (!Array.isArray(board) || !board.length || board.some((row) => !Array.isArray(row) || row.length !== board.length)) {
    return { rectangles: initialRects.map((rect) => ({ ...rect })), added: 0, error: "盤面データを読み取れませんでした。" };
  }

  const clues = collectClues(board);
  const rectangles = initialRects.map((rect) => ({ ...rect }));
  const validationError = validateUserRects(rectangles, board, clues);
  if (validationError) {
    return { rectangles, added: 0, error: validationError.message };
  }

  const candidatesByClue = enumerateCandidates(board, clues);
  let added = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const clue of clues) {
      if (rectangles.some((rect) => cluesInRect(rect, clues).some((insideClue) => insideClue.id === clue.id))) continue;
      const viable = candidatesByClue[clue.id].filter((candidate) => (
        rectangles.every((fixed) => !overlaps(candidate, fixed))
      ));
      if (viable.length !== 1) continue;
      const { x1, y1, x2, y2 } = viable[0];
      rectangles.push({ x1, y1, x2, y2 });
      added++;
      changed = true;
      break;
    }
  }

  return { rectangles, added, error: null };
}
