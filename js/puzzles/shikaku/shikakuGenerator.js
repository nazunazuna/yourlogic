const PRESETS = {
  // 難しいほど大きく多方向に置ける長方形を使い、1×数字だけで解ける領域を減らします。
  easy: {
    minArea: 3, targetArea: 6.5, maxArea: 10, minShortSide: 1, maxAspect: 7,
    extraSplitChance: 0.46, clueStyle: "edge", targetCandidates: 2.3, spacingWeight: 0.18,
    targetLogicScore: 3.35,
  },
  standard: {
    minArea: 4, targetArea: 9, maxArea: 18, minShortSide: 1, maxAspect: 5,
    extraSplitChance: 0.46, clueStyle: "balanced", targetCandidates: 3.2, spacingWeight: 0.45,
    targetLogicScore: 4.2,
  },
  hard: {
    minArea: 8, targetArea: 17, maxArea: 30, minShortSide: 2, maxAspect: 5,
    extraSplitChance: 0.25, clueStyle: "ambiguous", targetCandidates: 6.5, spacingWeight: 0.9,
    targetLogicScore: 6.3,
  },
  insane: {
    minArea: 12, targetArea: 25, maxArea: 42, minShortSide: 2, maxAspect: 5,
    extraSplitChance: 0.14, clueStyle: "ambiguous", targetCandidates: 10, spacingWeight: 1.25,
    targetLogicScore: 8.1,
  },
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

function dimensions(rect) {
  return { width: rect.x2 - rect.x1 + 1, height: rect.y2 - rect.y1 + 1 };
}

function possibleSplits(rect, preset) {
  const candidates = [];
  const { width, height } = dimensions(rect);
  for (let x = rect.x1; x < rect.x2; x++) {
    const parts = split(rect, { axis: "x", at: x });
    if (parts.some((part) => area(part) < preset.minArea)) continue;
    if (parts.some((part) => Math.min(dimensions(part).width, dimensions(part).height) < preset.minShortSide)) continue;
    candidates.push({ axis: "x", at: x });
  }
  for (let y = rect.y1; y < rect.y2; y++) {
    const parts = split(rect, { axis: "y", at: y });
    if (parts.some((part) => area(part) < preset.minArea)) continue;
    if (parts.some((part) => Math.min(dimensions(part).width, dimensions(part).height) < preset.minShortSide)) continue;
    candidates.push({ axis: "y", at: y });
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
  const cutUse = { x: new Map(), y: new Map() };

  while (pending.length) {
    const rect = pending.pop();
    const candidates = possibleSplits(rect, preset);
    const mustSplit = area(rect) > preset.maxArea;
    const maySplit = area(rect) > preset.targetArea * 1.12 && Math.random() < preset.extraSplitChance;
    if (!candidates.length || (!mustSplit && !maySplit)) {
      rectangles.push(rect);
      continue;
    }

    const ranked = candidates.map((candidate) => {
      const parts = split(rect, candidate);
      const balance = Math.abs(area(parts[0]) - area(parts[1])) / area(rect);
      const shape = Math.max(aspectPenalty(parts[0]), aspectPenalty(parts[1]));
      const target = parts.reduce((sum, part) => sum + Math.abs(Math.log(area(part) / preset.targetArea)), 0);
      const repeatedCut = cutUse[candidate.axis].get(candidate.at) || 0;
      const shapeOverflow = Math.max(0, shape - preset.maxAspect);
      return {
        candidate,
        score: balance * 0.9 + target * 0.34 + shape * 0.12 + shapeOverflow * 2.4
          + repeatedCut * (difficulty === "easy" ? 0.1 : 0.75) + Math.random() * 0.72,
      };
    }).sort((a, b) => a.score - b.score);
    const pool = ranked.slice(0, Math.min(6, ranked.length));
    const choice = pool[Math.floor(Math.random() * pool.length)].candidate;
    cutUse[choice.axis].set(choice.at, (cutUse[choice.axis].get(choice.at) || 0) + 1);
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

function intersectsCells(candidate, occupied) {
  return candidate.cells.some((cell) => occupied.has(cell));
}

function commonCells(candidates) {
  if (!candidates.length) return [];
  const common = new Set(candidates[0].cells);
  for (let index = 1; index < candidates.length && common.size; index++) {
    const next = new Set(candidates[index].cells);
    common.forEach((cell) => { if (!next.has(cell)) common.delete(cell); });
  }
  return [...common];
}

/**
 * 解答を見ず、候補が1つ・共通マス・その数字だけが届くマスを反復して論理プロファイルを測ります。
 * 生成時にこの値を難易度の目標へ近づけることで、領域サイズだけに頼らない出題にします。
 */
export function analyzeShikakuLogic(puzzleData) {
  const size = puzzleData.length;
  const { clues, candidatesByClue } = enumerateCandidates(puzzleData);
  const active = candidatesByClue.map((candidates) => candidates.slice());
  const initialCounts = active.map((candidates) => candidates.length);
  const fixed = new Map();
  let singleSteps = 0;
  let commonReductions = 0;
  let ownershipReductions = 0;
  let contradiction = initialCounts.some((count) => count === 0);
  let rounds = 0;

  while (!contradiction && rounds < 18) {
    rounds++;
    let changed = false;

    for (let clueIndex = 0; clueIndex < active.length; clueIndex++) {
      if (fixed.has(clueIndex) || active[clueIndex].length !== 1) continue;
      fixed.set(clueIndex, active[clueIndex][0]);
      singleSteps++;
      changed = true;
    }

    const occupied = new Set();
    for (const candidate of fixed.values()) {
      if (candidate.cells.some((cell) => occupied.has(cell))) {
        contradiction = true;
        break;
      }
      candidate.cells.forEach((cell) => occupied.add(cell));
    }
    if (contradiction) break;

    for (let clueIndex = 0; clueIndex < active.length; clueIndex++) {
      if (fixed.has(clueIndex)) continue;
      const filtered = active[clueIndex].filter((candidate) => !intersectsCells(candidate, occupied));
      if (!filtered.length) { contradiction = true; break; }
      if (filtered.length !== active[clueIndex].length) changed = true;
      active[clueIndex] = filtered;
    }
    if (contradiction) break;

    for (let clueIndex = 0; clueIndex < active.length; clueIndex++) {
      if (fixed.has(clueIndex) || active[clueIndex].length < 2) continue;
      const forcedCells = new Set(commonCells(active[clueIndex]));
      if (!forcedCells.size) continue;
      for (let other = 0; other < active.length; other++) {
        if (other === clueIndex || fixed.has(other)) continue;
        const filtered = active[other].filter((candidate) => !candidate.cells.some((cell) => forcedCells.has(cell)));
        if (!filtered.length) { contradiction = true; break; }
        if (filtered.length !== active[other].length) {
          commonReductions += active[other].length - filtered.length;
          active[other] = filtered;
          changed = true;
        }
      }
      if (contradiction) break;
    }
    if (contradiction) break;

    const ownersByCell = Array.from({ length: size * size }, () => new Set());
    active.forEach((candidates, clueIndex) => {
      if (fixed.has(clueIndex)) return;
      candidates.forEach((candidate) => candidate.cells.forEach((cell) => {
        if (!occupied.has(cell)) ownersByCell[cell].add(clueIndex);
      }));
    });
    for (let cell = 0; cell < ownersByCell.length; cell++) {
      const owners = ownersByCell[cell];
      if (occupied.has(cell) || owners.size !== 1) continue;
      const clueIndex = [...owners][0];
      const filtered = active[clueIndex].filter((candidate) => candidate.cells.includes(cell));
      if (!filtered.length) { contradiction = true; break; }
      if (filtered.length !== active[clueIndex].length) {
        ownershipReductions += active[clueIndex].length - filtered.length;
        active[clueIndex] = filtered;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const clueCount = Math.max(1, clues.length);
  const initialAverageCandidates = initialCounts.reduce((sum, count) => sum + count, 0) / clueCount;
  const initialSingleRatio = initialCounts.filter((count) => count === 1).length / clueCount;
  const resolvedCount = active.filter((candidates) => candidates.length === 1).length;
  const resolvedRatio = resolvedCount / clueCount;
  const remainingAverageCandidates = active.reduce((sum, candidates) => sum + candidates.length, 0) / clueCount;
  const logicScore = Math.log2(initialAverageCandidates + 1) * 1.45
    + (1 - initialSingleRatio) * 1.55
    + (1 - resolvedRatio) * 2.55
    + Math.min(1, commonReductions / clueCount) * 0.55
    + Math.min(1, ownershipReductions / clueCount) * 0.9;

  return {
    clueCount: clues.length,
    initialAverageCandidates,
    remainingAverageCandidates,
    initialSingleRatio,
    resolvedRatio,
    singleSteps,
    commonReductions,
    ownershipReductions,
    rounds,
    contradiction,
    logicScore,
  };
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

function positionTieScore(cell, rect, difficulty, occupied) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const edgeDistance = Math.min(cell.x - rect.x1, rect.x2 - cell.x, cell.y - rect.y1, rect.y2 - cell.y);
  const cx = (rect.x1 + rect.x2) / 2;
  const cy = (rect.y1 + rect.y2) / 2;
  const centerDistance = Math.abs(cell.x - cx) + Math.abs(cell.y - cy);
  let nearest = Infinity;
  occupied.forEach((value) => {
    const [x, y] = value.split(",").map(Number);
    nearest = Math.min(nearest, Math.abs(cell.x - x) + Math.abs(cell.y - y));
  });
  if (!Number.isFinite(nearest)) nearest = 4;
  if (difficulty === "easy") return edgeDistance * 0.8 - nearest * preset.spacingWeight + Math.random() * 0.25;
  if (difficulty === "standard") return Math.abs(edgeDistance - 1) * 0.3 - nearest * preset.spacingWeight + Math.random() * 0.35;
  return centerDistance * 0.18 - nearest * preset.spacingWeight + Math.random() * 0.55;
}

// 他の数字を障害物として使い、本来の長方形以外の候補をできるだけ減らします。
// これにより大盤面でも唯一解判定に入る前の分岐数を大幅に抑えられます。
function optimizeCluePositions(size, difficulty, solutionRects, passes = 5) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const largeBoardScale = size >= 50 ? 0.22 : size >= 40 ? 0.45 : size >= 30 ? 0.72 : 1;
  const targetCandidates = Math.max(1.4, preset.targetCandidates * largeBoardScale);
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
        tie: positionTieScore(cell, rect, difficulty, occupied),
      })).map((entry) => ({
        ...entry,
        score: Math.abs(Math.log1p(entry.count) - Math.log1p(targetCandidates)) * (size >= 40 ? 2.4 : 1.2)
          + entry.tie * (size >= 40 ? 0.04 : 0.1),
      })).sort((a, b) => a.score - b.score || a.tie - b.tie);
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

function chooseRepairCell(intended, alternative, difficulty, tried, solutionRects) {
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
    score: (Math.abs(cell.x - cx) + Math.abs(cell.y - cy)) * 0.2
      - Math.min(...solutionRects
        .filter((rect) => rect !== intended)
        .map((rect) => Math.abs(cell.x - rect.numX) + Math.abs(cell.y - rect.numY)))
        * (PRESETS[difficulty]?.spacingWeight || 0.5)
      + Math.random() * 1.2,
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
      const next = chooseRepairCell(intended, candidate, difficulty, tried, solutionRects);
      if (next) mismatches.push({ intended, next, tried });
    });
    if (!mismatches.length) return null;

    // 一つずつ直すと大盤面で似た別解を何度も探索するため、難易度に応じた少数を同時に移動します。
    const repairCount = Math.min(
      mismatches.length,
      size >= 40 ? 8 : ({ easy: 6, standard: 5, hard: 4, insane: 3 }[difficulty] || 4),
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
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const values = solutionRects.map((rect) => rect.value);
  if (values.some((value) => value <= 1)) return false;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const thinRatio = solutionRects.filter((rect) => {
    const { width, height } = dimensions(rect);
    return width === 1 || height === 1;
  }).length / solutionRects.length;
  const aspectOverflow = solutionRects.some((rect) => aspectPenalty(rect) > preset.maxAspect + 0.01);
  const minimumAverage = { easy: 4.6, standard: 6, hard: 11, insane: 16 }[difficulty] || 6;
  const maximumThinRatio = { easy: 0.75, standard: 0.32, hard: 0, insane: 0 }[difficulty] ?? 0.32;
  return average >= minimumAverage && thinRatio <= maximumThinRatio && !aspectOverflow;
}

function averageNearestClueDistance(solutionRects) {
  if (solutionRects.length < 2) return 0;
  return solutionRects.reduce((sum, rect, index) => {
    let nearest = Infinity;
    solutionRects.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      nearest = Math.min(nearest, Math.abs(rect.numX - other.numX) + Math.abs(rect.numY - other.numY));
    });
    return sum + nearest;
  }, 0) / solutionRects.length;
}

function evaluatePuzzle(puzzleData, solutionRects, difficulty) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const averageArea = solutionRects.reduce((sum, rect) => sum + rect.value, 0) / solutionRects.length;
  const thinRatio = solutionRects.filter((rect) => {
    const { width, height } = dimensions(rect);
    return width === 1 || height === 1;
  }).length / solutionRects.length;
  const clueDistance = averageNearestClueDistance(solutionRects);
  const logic = analyzeShikakuLogic(puzzleData);
  const minimumSpacing = { easy: 1, standard: 1.5, hard: 2.1, insane: 2.5 }[difficulty] || 1.5;
  const distance = Math.abs(logic.logicScore - preset.targetLogicScore)
    + Math.max(0, preset.targetArea * 0.72 - averageArea) * 0.16
    + Math.max(0, minimumSpacing - clueDistance) * 0.7
    + thinRatio * (difficulty === "easy" ? 1 : difficulty === "standard" ? 4 : 24)
    + (logic.contradiction ? 100 : 0);
  return { distance, averageArea, thinRatio, clueDistance, logic };
}

export function generateShikakuPuzzle(size, difficulty = "standard", maxAttempts = 18) {
  const attempts = Math.max(4, Math.min(maxAttempts, 24));
  const deadline = performance.now() + (size >= 50 ? 12000 : size >= 40 ? 9000 : size >= 30 ? 7000 : 5000);
  const tolerance = { easy: 1.8, standard: 2, hard: 2.25, insane: 2.5 }[difficulty] || 2;
  let best = null;
  let bestEvaluation = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (performance.now() > deadline) break;
    const rectangles = createPartition(size, difficulty);
    const solutionRects = createSolutionRects(rectangles, difficulty);
    if (!qualityAcceptable(solutionRects, difficulty)) continue;
    const cluePasses = size >= 40 ? 3 : size >= 30 ? 5 : difficulty === "easy" ? 4 : 7;
    optimizeCluePositions(size, difficulty, solutionRects, cluePasses);
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
      maxNodes: size >= 40 ? 320000 : 650000,
      deadline,
    });
    if (verification.exhausted || verification.solutions.length !== 1) continue;
    const evaluation = evaluatePuzzle(repaired.puzzleData, repaired.solutionRects, difficulty);
    if (!bestEvaluation || evaluation.distance < bestEvaluation.distance) {
      best = repaired;
      bestEvaluation = evaluation;
    }
    if (evaluation.distance <= tolerance) return repaired;
  }
  return best;
}
