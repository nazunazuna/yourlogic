const PRESETS = {
  easy: { minArea: 4, maxArea: 18, extraSplitChance: 0.28 },
  standard: { minArea: 3, maxArea: 13, extraSplitChance: 0.46 },
  hard: { minArea: 2, maxArea: 9, extraSplitChance: 0.62 },
  insane: { minArea: 1, maxArea: 6, extraSplitChance: 0.78 },
};

function area(rect) {
  return (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
}

function possibleSplits(rect, minArea) {
  const candidates = [];
  const width = rect.x2 - rect.x1 + 1;
  const height = rect.y2 - rect.y1 + 1;
  for (let x = rect.x1; x < rect.x2; x++) {
    if ((x - rect.x1 + 1) * height >= minArea && (rect.x2 - x) * height >= minArea) {
      candidates.push({ axis: "x", at: x });
    }
  }
  for (let y = rect.y1; y < rect.y2; y++) {
    if ((y - rect.y1 + 1) * width >= minArea && (rect.y2 - y) * width >= minArea) {
      candidates.push({ axis: "y", at: y });
    }
  }
  return candidates;
}

function split(rect, candidate) {
  if (candidate.axis === "x") {
    return [
      { x1: rect.x1, y1: rect.y1, x2: candidate.at, y2: rect.y2 },
      { x1: candidate.at + 1, y1: rect.y1, x2: rect.x2, y2: rect.y2 },
    ];
  }
  return [
    { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: candidate.at },
    { x1: rect.x1, y1: candidate.at + 1, x2: rect.x2, y2: rect.y2 },
  ];
}

function createPartition(size, difficulty) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const pending = [{ x1: 0, y1: 0, x2: size - 1, y2: size - 1 }];
  const rectangles = [];

  while (pending.length) {
    const rect = pending.pop();
    const candidates = possibleSplits(rect, preset.minArea);
    const mustSplit = area(rect) > preset.maxArea;
    const maySplit = area(rect) >= preset.minArea * 2 && Math.random() < preset.extraSplitChance;
    if (!candidates.length || (!mustSplit && !maySplit)) {
      rectangles.push(rect);
      continue;
    }

    candidates.sort((a, b) => {
      const aParts = split(rect, a).map(area);
      const bParts = split(rect, b).map(area);
      return Math.abs(aParts[0] - aParts[1]) - Math.abs(bParts[0] - bParts[1]) + (Math.random() - .5) * 4;
    });
    const choice = candidates[Math.floor(Math.random() * Math.min(4, candidates.length))];
    pending.push(...split(rect, choice));
  }
  return rectangles;
}

function placeClues(size, rectangles) {
  const puzzleData = Array.from({ length: size }, () => Array(size).fill(0));
  const solutionRects = rectangles.map((rect, index) => {
    const value = area(rect);
    const width = rect.x2 - rect.x1 + 1;
    const height = rect.y2 - rect.y1 + 1;
    const numX = rect.x1 + Math.floor(Math.random() * width);
    const numY = rect.y1 + Math.floor(Math.random() * height);
    puzzleData[numY][numX] = value;
    return { ...rect, id: index, value, numX, numY };
  });
  return { puzzleData, solutionRects };
}

function enumerateCandidates(puzzleData) {
  const size = puzzleData.length;
  const clues = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (puzzleData[y][x] > 0) clues.push({ x, y, value: Number(puzzleData[y][x]) });
    }
  }

  const candidatesByClue = clues.map(() => []);
  clues.forEach((clue, clueIndex) => {
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
          let clueCount = 0;
          for (let y = rect.y1; y <= rect.y2 && clueCount <= 1; y++) {
            for (let x = rect.x1; x <= rect.x2; x++) {
              if (puzzleData[y][x] > 0) clueCount++;
            }
          }
          if (clueCount !== 1) continue;
          const cells = [];
          for (let y = rect.y1; y <= rect.y2; y++) {
            for (let x = rect.x1; x <= rect.x2; x++) cells.push(y * size + x);
          }
          candidatesByClue[clueIndex].push({ ...rect, cells });
        }
      }
    }
  });
  return { clues, candidatesByClue };
}

/**
 * 与えられた四角に切れの解数を2件まで数えます。
 * 2は「複数解」、0は「解なし」、1だけが保存可能な問題です。
 */
export function countShikakuSolutions(puzzleData, { limit = 2, maxNodes = 250000 } = {}) {
  const size = puzzleData.length;
  const { clues, candidatesByClue } = enumerateCandidates(puzzleData);
  if (!clues.length || candidatesByClue.some((items) => items.length === 0)) return 0;

  const covered = new Uint8Array(size * size);
  const used = new Uint8Array(clues.length);
  let usedCount = 0;
  let coveredCount = 0;
  let solutions = 0;
  let nodes = 0;

  function available(candidate) {
    return candidate.cells.every((cell) => covered[cell] === 0);
  }

  function search() {
    if (solutions >= limit || nodes++ >= maxNodes) return;
    if (usedCount === clues.length) {
      if (coveredCount === size * size) solutions++;
      return;
    }

    let chosen = -1;
    let choices = null;
    for (let i = 0; i < clues.length; i++) {
      if (used[i]) continue;
      const viable = candidatesByClue[i].filter(available);
      if (!viable.length) return;
      if (!choices || viable.length < choices.length) {
        chosen = i;
        choices = viable;
        if (choices.length === 1) break;
      }
    }

    used[chosen] = 1;
    usedCount++;
    for (const candidate of choices) {
      for (const cell of candidate.cells) covered[cell] = 1;
      coveredCount += candidate.cells.length;
      search();
      coveredCount -= candidate.cells.length;
      for (const cell of candidate.cells) covered[cell] = 0;
      if (solutions >= limit || nodes >= maxNodes) break;
    }
    usedCount--;
    used[chosen] = 0;
  }

  search();
  // 探索上限へ達した問題は安全側で「複数解扱い」にして保存しません。
  return nodes >= maxNodes && solutions < limit ? limit : solutions;
}

/*
 * 大盤面でも生成待ちが長引かないための保証付き構成。
 * 数字1の細い区切り線で領域を独立させ、各空白領域を1つの長方形にします。
 * 区切りをまたぐ長方形は必ず別の数字を含むため、解は構造上1通りです。
 */
function generateGuaranteedPuzzle(size, difficulty) {
  const baseGap = ({ easy: 4, standard: 5, hard: 6, insane: 7 })[difficulty] || 5;
  const separatorRows = new Set();
  const separatorCols = new Set();
  for (let cursor = baseGap - 1; cursor < size - 1;) {
    separatorRows.add(cursor);
    cursor += Math.max(3, baseGap + (Math.floor(Math.random() * 3) - 1));
  }
  for (let cursor = baseGap - 1; cursor < size - 1;) {
    separatorCols.add(cursor);
    cursor += Math.max(3, baseGap + (Math.floor(Math.random() * 3) - 1));
  }

  const rectangles = [];
  for (const y of separatorRows) {
    for (let x = 0; x < size; x++) rectangles.push({ x1: x, y1: y, x2: x, y2: y });
  }
  for (const x of separatorCols) {
    for (let y = 0; y < size; y++) {
      if (!separatorRows.has(y)) rectangles.push({ x1: x, y1: y, x2: x, y2: y });
    }
  }

  function intervals(separators) {
    const result = [];
    let start = 0;
    for (let i = 0; i <= size; i++) {
      if (i === size || separators.has(i)) {
        if (start <= i - 1) result.push([start, i - 1]);
        start = i + 1;
      }
    }
    return result;
  }

  const rows = intervals(separatorRows);
  const cols = intervals(separatorCols);
  for (const [y1, y2] of rows) {
    for (const [x1, x2] of cols) rectangles.push({ x1, y1, x2, y2 });
  }
  return placeClues(size, rectangles);
}

export function generateShikakuPuzzle(size, difficulty = "standard", maxAttempts = 80) {
  const randomAttempts = Math.min(maxAttempts, size <= 10 ? 30 : 3);
  for (let attempt = 0; attempt < randomAttempts; attempt++) {
    const generated = placeClues(size, createPartition(size, difficulty));
    if (countShikakuSolutions(generated.puzzleData, { maxNodes: size <= 10 ? 250000 : 40000 }) === 1) return generated;
  }
  const guaranteed = generateGuaranteedPuzzle(size, difficulty);
  return countShikakuSolutions(guaranteed.puzzleData, { maxNodes: 250000 }) === 1 ? guaranteed : null;
}
