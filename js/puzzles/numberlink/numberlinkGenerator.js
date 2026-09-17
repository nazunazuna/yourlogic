import {
  normalizeNumberlinkProblem,
  numberlinkEdgeKey,
  numberlinkSolutionOwners,
  solveNumberlink,
} from "./numberlinkSolver.js?v=20260918-1";

const PRESETS = Object.freeze({
  easy: { size: 5, attempts: 8, iterations: 500, minBends: 4, maxStraightRatio: .6, minBranches: 0 },
  standard: { size: 10, attempts: 8, iterations: 3_000, minBends: 16, maxStraightRatio: .25, minBranches: 1 },
  hard: { size: 20, attempts: 8, iterations: 250, minBends: 25, maxStraightRatio: .2, minBranches: 5 },
  insane: { size: 30, attempts: 6, iterations: 150, minBends: 30, maxStraightRatio: .2, minBranches: 5 },
});

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function neighborsFor(size) {
  const neighbors = Array.from({ length: size * size }, () => []);
  for (let cell = 0; cell < size * size; cell++) {
    const x = cell % size;
    const y = Math.floor(cell / size);
    if (y > 0) neighbors[cell].push(cell - size);
    if (y + 1 < size) neighbors[cell].push(cell + size);
    if (x > 0) neighbors[cell].push(cell - 1);
    if (x + 1 < size) neighbors[cell].push(cell + 1);
  }
  return neighbors;
}

function initialPartition(size) {
  const paths = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(y * size + x);
    if ((y + randomInt(2)) % 2) row.reverse();
    paths.push(row);
  }
  return paths;
}

function pathMetrics(path, size) {
  let bends = 0;
  let interiorBends = 0;
  for (let index = 1; index < path.length - 1; index++) {
    const before = path[index - 1];
    const cell = path[index];
    const after = path[index + 1];
    const first = [Math.floor(cell / size) - Math.floor(before / size), (cell % size) - (before % size)];
    const second = [Math.floor(after / size) - Math.floor(cell / size), (after % size) - (cell % size)];
    if (first[0] === second[0] && first[1] === second[1]) continue;
    bends++;
    const x = cell % size;
    const y = Math.floor(cell / size);
    if (x > 0 && y > 0 && x + 1 < size && y + 1 < size) interiorBends++;
  }
  return { bends, interiorBends, length: path.length };
}

function localScore(path, size) {
  const metrics = pathMetrics(path, size);
  let score = metrics.interiorBends * 3 + (metrics.bends - metrics.interiorBends) * .4;
  if (!metrics.bends) score -= 26;
  if (metrics.length < 4) score -= 45;
  score -= Math.abs(metrics.length - size) ** 1.35 * .12;
  return score;
}

/**
 * 各経路の端の1マスだけを隣の経路へ移し、経路同士が自分自身へ横接触しない分割を崩します。
 * 全マス使用・連結・非交差・自己接触なしは、すべての移動で維持されます。
 */
function createInducedPartition(size, iterations) {
  const neighbors = neighborsFor(size);
  const paths = initialPartition(size);
  const owner = new Int16Array(size * size);
  const scores = paths.map((path) => localScore(path, size));
  paths.forEach((path, color) => path.forEach((cell) => { owner[cell] = color; }));

  for (let step = 0; step < iterations; step++) {
    const sourceColor = randomInt(paths.length);
    const source = paths[sourceColor];
    if (source.length <= 3) continue;
    const fromEnd = Math.random() < .5;
    const cell = fromEnd ? source.at(-1) : source[0];
    const targets = [];

    for (const neighbor of neighbors[cell]) {
      const targetColor = owner[neighbor];
      if (targetColor === sourceColor) continue;
      const target = paths[targetColor];
      const atStart = target[0] === neighbor;
      if (!atStart && target.at(-1) !== neighbor) continue;
      let touches = 0;
      for (const around of neighbors[cell]) if (owner[around] === targetColor) touches++;
      if (touches === 1) targets.push({ targetColor, atStart });
    }
    if (!targets.length) continue;

    const targetInfo = targets[randomInt(targets.length)];
    const target = paths[targetInfo.targetColor];
    const nextSource = fromEnd ? source.slice(0, -1) : source.slice(1);
    const nextTarget = targetInfo.atStart ? [cell, ...target] : [...target, cell];
    const nextSourceScore = localScore(nextSource, size);
    const nextTargetScore = localScore(nextTarget, size);
    const delta = nextSourceScore + nextTargetScore - scores[sourceColor] - scores[targetInfo.targetColor];
    const temperature = Math.max(.08, 4.5 * (1 - step / iterations));
    if (delta < 0 && Math.random() >= Math.exp(delta / temperature)) continue;

    paths[sourceColor] = nextSource;
    paths[targetInfo.targetColor] = nextTarget;
    scores[sourceColor] = nextSourceScore;
    scores[targetInfo.targetColor] = nextTargetScore;
    owner[cell] = targetInfo.targetColor;
  }
  return paths;
}

function puzzleFromPaths(size, paths) {
  const problemData = Array(size * size).fill(0);
  const solutionEdges = [];
  const neighbors = neighborsFor(size);
  const ordered = [...paths].sort((left, right) => {
    const leftBoundary = neighbors[left[0]].length + neighbors[left.at(-1)].length;
    const rightBoundary = neighbors[right[0]].length + neighbors[right.at(-1)].length;
    return leftBoundary - rightBoundary || right.length - left.length;
  });
  ordered.forEach((path, index) => {
    const label = index + 1;
    problemData[path[0]] = label;
    problemData[path.at(-1)] = label;
    for (let cursor = 1; cursor < path.length; cursor++) {
      solutionEdges.push(numberlinkEdgeKey(path[cursor - 1], path[cursor]));
    }
  });
  return { problemData, solutionEdges, paths: ordered };
}

function intendedMatches(solutionEdges, foundEdges) {
  if (solutionEdges.length !== foundEdges.length) return false;
  const found = new Set(foundEdges);
  return solutionEdges.every((edge) => found.has(edge));
}

function qualityMetrics(paths, size) {
  const metrics = paths.map((path) => pathMetrics(path, size));
  const bends = metrics.reduce((sum, item) => sum + item.bends, 0);
  const interiorBends = metrics.reduce((sum, item) => sum + item.interiorBends, 0);
  const straightCount = metrics.filter((item) => item.bends === 0).length;
  const lengths = metrics.map((item) => item.length);
  return {
    pairCount: paths.length,
    bends,
    interiorBends,
    straightRatio: straightCount / paths.length,
    shortestPath: Math.min(...lengths),
    longestPath: Math.max(...lengths),
    averagePath: size * size / paths.length,
  };
}

function qualityAcceptable(metrics, preset, solverBranches) {
  return metrics.bends >= preset.minBends
    && metrics.straightRatio <= preset.maxStraightRatio
    && metrics.shortestPath >= 3
    && solverBranches >= preset.minBranches;
}

function verifyCandidate(candidate, size, difficulty) {
  const maxNodes = difficulty === "insane" ? 1_200_000 : difficulty === "hard" ? 1_000_000 : 700_000;
  const timeLimit = difficulty === "insane" ? 1_800 : difficulty === "hard" ? 1_500 : difficulty === "standard" ? 1_200 : 900;
  const result = solveNumberlink(candidate.problemData, size, {
    limit: 2,
    maxNodes,
    deadline: (typeof performance !== "undefined" ? performance.now() : Date.now()) + timeLimit,
  });
  return {
    valid: !result.exhausted && result.solutions.length === 1
      && intendedMatches(candidate.solutionEdges, result.solutions[0]),
    result,
  };
}

export function numberlinkSizeForDifficulty(difficulty = "standard") {
  return (PRESETS[difficulty] || PRESETS.standard).size;
}

export function generateNumberlinkPuzzle(requestedSize, difficulty = "standard", maxAttempts = null) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const size = Number(requestedSize) || preset.size;
  if (![5, 10, 20, 30].includes(size)) return null;
  const attempts = Math.max(1, Math.min(Number(maxAttempts) || preset.attempts, 14));
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const paths = createInducedPartition(size, preset.iterations + attempt * Math.max(8, Math.floor(size / 2)));
    const candidate = puzzleFromPaths(size, paths);
    const metrics = qualityMetrics(candidate.paths, size);
    const verification = verifyCandidate(candidate, size, difficulty);
    if (!verification.valid) continue;
    const generated = {
      problemData: normalizeNumberlinkProblem(candidate.problemData, size).grid,
      solutionData: {
        edges: verification.result.solutions[0],
        owners: numberlinkSolutionOwners(candidate.problemData, size, verification.result.solutions[0]),
      },
      metrics: {
        ...metrics,
        solverNodes: verification.result.nodes,
        solverBranches: verification.result.branches,
        noSelfTouch: true,
      },
    };
    if (qualityAcceptable(metrics, preset, verification.result.branches)) return generated;
    const qualityScore = metrics.bends - metrics.straightRatio * size * 3
      + Math.log2(verification.result.branches + 1) * 5;
    const bestScore = best
      ? best.metrics.bends - best.metrics.straightRatio * size * 3 + Math.log2(best.metrics.solverBranches + 1) * 5
      : -Infinity;
    if (qualityScore > bestScore) best = generated;
  }
  if (best) return best;

  // 生成探索が制限時間内に収まらない端末でも開始不能にしないための、一意解確認済みの基準形です。
  const fallback = puzzleFromPaths(size, initialPartition(size));
  const verification = verifyCandidate(fallback, size, difficulty);
  if (!verification.valid) return null;
  const metrics = qualityMetrics(fallback.paths, size);
  return {
    problemData: fallback.problemData,
    solutionData: {
      edges: verification.result.solutions[0],
      owners: numberlinkSolutionOwners(fallback.problemData, size, verification.result.solutions[0]),
    },
    metrics: {
      ...metrics,
      solverNodes: verification.result.nodes,
      solverBranches: verification.result.branches,
      noSelfTouch: true,
      fallback: true,
    },
  };
}
