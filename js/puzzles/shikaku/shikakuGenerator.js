const PRESETS = {
  // 難しいほど領域を大きくし、数字1に頼らず候補長方形が増える構成にします。
  easy: { minArea: 2, maxArea: 7, extraSplitChance: 0.72, clueStyle: "edge" },
  standard: { minArea: 3, maxArea: 12, extraSplitChance: 0.52, clueStyle: "edge" },
  hard: { minArea: 4, maxArea: 14, extraSplitChance: 0.36, clueStyle: "random" },
  insane: { minArea: 4, maxArea: 16, extraSplitChance: 0.28, clueStyle: "inner" },
};

function area(rect) {
  return (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
}

function sameRect(a, b) {
  return a && b && a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

function contains(rect, x, y) {
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
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

function aspectPenalty(rect) {
  const width = rect.x2 - rect.x1 + 1;
  const height = rect.y2 - rect.y1 + 1;
  return Math.max(width / height, height / width);
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

    const ranked = candidates.map((candidate) => {
      const parts = split(rect, candidate);
      const balance = Math.abs(area(parts[0]) - area(parts[1])) / area(rect);
      const shape = Math.max(aspectPenalty(parts[0]), aspectPenalty(parts[1]));
      return { candidate, score: balance * 2 + shape * 0.18 + Math.random() * 0.65 };
    }).sort((a, b) => a.score - b.score);
    const pool = ranked.slice(0, Math.min(6, ranked.length));
    const choice = pool[Math.floor(Math.random() * pool.length)].candidate;
    pending.push(...split(rect, choice));
  }
  return rectangles;
}

function cellsIn(rect) {
  const cells = [];
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) cells.push({ x, y });
  }
  return cells;
}

function chooseClueCell(rect, style) {
  const cells = cellsIn(rect);
  if (style === "edge") {
    const edge = cells.filter(({ x, y }) => x === rect.x1 || x === rect.x2 || y === rect.y1 || y === rect.y2);
    return edge[Math.floor(Math.random() * edge.length)];
  }
  if (style === "inner") {
    const cx = (rect.x1 + rect.x2) / 2;
    const cy = (rect.y1 + rect.y2) / 2;
    return cells.map((cell) => ({
      cell,
      score: Math.abs(cell.x - cx) + Math.abs(cell.y - cy) + Math.random() * 1.8,
    })).sort((a, b) => a.score - b.score)[0].cell;
  }
  return cells[Math.floor(Math.random() * cells.length)];
}

function createSolutionRects(rectangles, difficulty) {
  const style = (PRESETS[difficulty] || PRESETS.standard).clueStyle;
  return rectangles.map((rect, id) => {
    const clue = chooseClueCell(rect, style);
    return { ...rect, id, value: area(rect), numX: clue.x, numY: clue.y };
  });
}

function boardFromSolution(size, solutionRects) {
  const puzzleData = Array.from({ length: size }, () => Array(size).fill(0));
  solutionRects.forEach((rect) => { puzzleData[rect.numY][rect.numX] = rect.value; });
  return puzzleData;
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

function solveShikaku(puzzleData, { limit = 2, maxNodes = 300000, deadline = Infinity } = {}) {
  const size = puzzleData.length;
  const { clues, candidatesByClue } = enumerateCandidates(puzzleData);
  if (!clues.length || candidatesByClue.some((items) => items.length === 0)) {
    return { clues, solutions: [], exhausted: false, nodes: 0 };
  }

  // 「各数字を1回使う」と「各マスを1回覆う」を列にした exact-cover として探索します。
  // 候補同士の衝突を選択時にまとめて無効化するため、大盤面でも全候補を毎回再検査しません。
  const columnCount = clues.length + size * size;
  const rowsByColumn = Array.from({ length: columnCount }, () => []);
  const options = [];
  candidatesByClue.forEach((candidates, clueIndex) => {
    candidates.forEach((candidate) => {
      const columns = [clueIndex, ...candidate.cells.map((cell) => clues.length + cell)];
      const rowIndex = options.length;
      options.push({ clueIndex, candidate, columns });
      columns.forEach((column) => rowsByColumn[column].push(rowIndex));
    });
  });

  const activeRows = new Uint8Array(options.length).fill(1);
  const coveredColumns = new Uint8Array(columnCount);
  const activeCounts = Int32Array.from(rowsByColumn, (rows) => rows.length);
  const chosenRects = Array(clues.length).fill(null);
  let selectedCount = 0;
  let nodes = 0;
  let exhausted = false;
  const solutions = [];

  function search() {
    if (solutions.length >= limit) return;
    if (nodes >= maxNodes) {
      exhausted = true;
      return;
    }
    nodes++;
    if ((nodes & 255) === 0 && performance.now() > deadline) {
      exhausted = true;
      return;
    }
    let selectedColumn = -1;
    let smallestCount = Infinity;
    for (let column = 0; column < columnCount; column++) {
      if (coveredColumns[column]) continue;
      const count = activeCounts[column];
      if (count === 0) return;
      if (count < smallestCount) {
        smallestCount = count;
        selectedColumn = column;
        if (count === 1) break;
      }
    }

    if (selectedColumn === -1) {
      if (selectedCount === clues.length) {
        solutions.push(chosenRects.map((rect) => ({ x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 })));
      }
      return;
    }

    for (const rowIndex of rowsByColumn[selectedColumn]) {
      if (!activeRows[rowIndex]) continue;
      const option = options[rowIndex];
      if (option.columns.some((column) => coveredColumns[column])) continue;

      const deactivatedRows = [];
      option.columns.forEach((column) => {
        coveredColumns[column] = 1;
        rowsByColumn[column].forEach((conflictingRow) => {
          if (!activeRows[conflictingRow]) return;
          activeRows[conflictingRow] = 0;
          deactivatedRows.push(conflictingRow);
          options[conflictingRow].columns.forEach((affectedColumn) => { activeCounts[affectedColumn]--; });
        });
      });

      selectedCount++;
      chosenRects[option.clueIndex] = option.candidate;
      search();
      chosenRects[option.clueIndex] = null;
      selectedCount--;

      for (let index = deactivatedRows.length - 1; index >= 0; index--) {
        const restoredRow = deactivatedRows[index];
        activeRows[restoredRow] = 1;
        options[restoredRow].columns.forEach((affectedColumn) => { activeCounts[affectedColumn]++; });
      }
      option.columns.forEach((column) => { coveredColumns[column] = 0; });
      if (solutions.length >= limit || exhausted) break;
    }
  }

  search();
  return { clues, solutions, exhausted, nodes };
}

/** 0=解なし、1=唯一解、2=複数解または探索上限超過です。 */
export function countShikakuSolutions(puzzleData, options = {}) {
  const result = solveShikaku(puzzleData, { ...options, limit: options.limit || 2 });
  if (result.exhausted && result.solutions.length < 2) return 2;
  return Math.min(2, result.solutions.length);
}

function legalRectsAt(size, value, point, otherClues) {
  const result = [];
  for (let height = 1; height <= value; height++) {
    if (value % height !== 0) continue;
    const width = value / height;
    if (width > size || height > size) continue;
    const minX = Math.max(0, point.x - width + 1);
    const maxX = Math.min(point.x, size - width);
    const minY = Math.max(0, point.y - height + 1);
    const maxY = Math.min(point.y, size - height);
    for (let y1 = minY; y1 <= maxY; y1++) {
      for (let x1 = minX; x1 <= maxX; x1++) {
        const candidate = { x1, y1, x2: x1 + width - 1, y2: y1 + height - 1 };
        let blocked = false;
        for (let y = candidate.y1; y <= candidate.y2 && !blocked; y++) {
          for (let x = candidate.x1; x <= candidate.x2; x++) {
            if (otherClues.has(`${x},${y}`)) { blocked = true; break; }
          }
        }
        if (!blocked) result.push(candidate);
      }
    }
  }
  return result;
}

function positionTieScore(cell, rect, difficulty) {
  const edgeDistance = Math.min(cell.x - rect.x1, rect.x2 - cell.x, cell.y - rect.y1, rect.y2 - cell.y);
  const cx = (rect.x1 + rect.x2) / 2;
  const cy = (rect.y1 + rect.y2) / 2;
  const centerDistance = Math.abs(cell.x - cx) + Math.abs(cell.y - cy);
  if (difficulty === "easy" || difficulty === "standard") return edgeDistance + Math.random() * 0.25;
  return centerDistance + Math.random() * 0.8;
}

// 他の数字を障害物として使い、本来の長方形以外の候補をできるだけ減らします。
// これにより大盤面でも唯一解判定に入る前の分岐数を大幅に抑えられます。
function optimizeCluePositions(size, difficulty, solutionRects, passes = 5) {
  const occupied = new Set(solutionRects.map((rect) => `${rect.numX},${rect.numY}`));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    const order = [...solutionRects].sort(() => Math.random() - 0.5);
    for (const rect of order) {
      const currentKey = `${rect.numX},${rect.numY}`;
      occupied.delete(currentKey);
      const ranked = cellsIn(rect).map((cell) => ({
        cell,
        count: legalRectsAt(size, rect.value, cell, occupied).length,
        tie: positionTieScore(cell, rect, difficulty),
      })).sort((a, b) => a.count - b.count || a.tie - b.tie);
      const best = ranked[0];
      if (best && (best.cell.x !== rect.numX || best.cell.y !== rect.numY)) {
        rect.numX = best.cell.x;
        rect.numY = best.cell.y;
        changed = true;
      }
      occupied.add(`${rect.numX},${rect.numY}`);
    }
    if (!changed) break;
  }
}

function intendedRectsForClues(clues, solutionRects) {
  return clues.map((clue) => solutionRects.find((rect) => rect.numX === clue.x && rect.numY === clue.y));
}

function chooseRepairCell(intended, alternative, difficulty, tried) {
  const options = cellsIn(intended).filter(({ x, y }) => {
    return !contains(alternative, x, y) && !tried.has(`${x},${y}`);
  });
  if (!options.length) return null;

  if (difficulty === "easy") {
    return options.map((cell) => ({
      cell,
      score: Math.min(
        cell.x - intended.x1,
        intended.x2 - cell.x,
        cell.y - intended.y1,
        intended.y2 - cell.y,
      ) + Math.random() * 0.3,
    })).sort((a, b) => a.score - b.score)[0].cell;
  }

  const cx = (intended.x1 + intended.x2) / 2;
  const cy = (intended.y1 + intended.y2) / 2;
  return options.map((cell) => ({
    cell,
    score: Math.abs(cell.x - cx) + Math.abs(cell.y - cy) + Math.random() * 2,
  })).sort((a, b) => a.score - b.score)[0].cell;
}

// 複数解が見つかった場合、その別解だけを壊すように数字を本来の領域内で移動します。
function makeUnique(size, difficulty, solutionRects, maxRounds, deadline) {
  const triedByRect = new Map(solutionRects.map((rect) => [rect.id, new Set([`${rect.numX},${rect.numY}`])]));
  let puzzleData = boardFromSolution(size, solutionRects);

  for (let round = 0; round < maxRounds; round++) {
    if (performance.now() > deadline) return null;
    const result = solveShikaku(puzzleData, {
      limit: 2,
      maxNodes: size >= 40 ? 180000 : 300000,
      deadline,
    });
    if (!result.exhausted && result.solutions.length === 1) {
      return { puzzleData, solutionRects };
    }
    if (result.exhausted || result.solutions.length < 2) return null;

    const intendedByClue = intendedRectsForClues(result.clues, solutionRects);
    const alternative = result.solutions.find((candidateSolution) => {
      return candidateSolution.some((candidate, index) => !sameRect(candidate, intendedByClue[index]));
    });
    if (!alternative) return { puzzleData, solutionRects };

    const mismatches = [];
    alternative.forEach((candidate, index) => {
      const intended = intendedByClue[index];
      if (!intended || sameRect(candidate, intended)) return;
      const tried = triedByRect.get(intended.id);
      const next = chooseRepairCell(intended, candidate, difficulty, tried);
      if (next) mismatches.push({ intended, next, tried });
    });
    if (!mismatches.length) return null;

    // 一つずつ直すと大盤面で似た別解を何度も探索するため、難易度に応じた少数を同時に移動します。
    const repairCount = Math.min(
      mismatches.length,
      { easy: 6, standard: 5, hard: 4, insane: 3 }[difficulty] || 4,
    );
    mismatches.sort(() => Math.random() - 0.5).slice(0, repairCount).forEach((repair) => {
      repair.intended.numX = repair.next.x;
      repair.intended.numY = repair.next.y;
      repair.tried.add(`${repair.next.x},${repair.next.y}`);
    });
    puzzleData = boardFromSolution(size, solutionRects);
  }
  return null;
}

function qualityAcceptable(solutionRects, difficulty) {
  const values = solutionRects.map((rect) => rect.value);
  if (values.some((value) => value <= 1)) return false;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimumAverage = { easy: 2.4, standard: 4, hard: 6, insane: 8 }[difficulty] || 4;
  return average >= minimumAverage;
}

export function generateShikakuPuzzle(size, difficulty = "standard", maxAttempts = 18) {
  const attempts = Math.max(4, Math.min(maxAttempts, 24));
  const deadline = performance.now() + (size >= 50 ? 8000 : size >= 40 ? 6000 : 4000);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (performance.now() > deadline) break;
    const rectangles = createPartition(size, difficulty);
    const solutionRects = createSolutionRects(rectangles, difficulty);
    if (!qualityAcceptable(solutionRects, difficulty)) continue;
    optimizeCluePositions(size, difficulty, solutionRects);
    const repaired = makeUnique(
      size,
      difficulty,
      solutionRects,
      Math.max(18, Math.ceil(solutionRects.length / 2)),
      deadline,
    );
    if (!repaired) continue;
    const verification = solveShikaku(repaired.puzzleData, {
      limit: 2,
      maxNodes: size >= 40 ? 220000 : 500000,
      deadline,
    });
    if (!verification.exhausted && verification.solutions.length === 1) return repaired;
  }
  return null;
}
