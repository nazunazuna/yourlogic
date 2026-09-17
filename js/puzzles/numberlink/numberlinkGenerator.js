import {
  normalizeNumberlinkProblem,
  numberlinkEdgeKey,
  numberlinkSolutionOwners,
  solveNumberlink,
} from "./numberlinkSolver.js";

const PRESETS = Object.freeze({
  easy: { size: 5, pairs: 8, attempts: 22, mix: 90 },
  standard: { size: 6, pairs: 8, attempts: 26, mix: 150 },
  hard: { size: 7, pairs: 7, attempts: 30, mix: 240 },
  insane: { size: 8, pairs: 6, attempts: 34, mix: 360 },
});

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function adjacent(left, right, size) {
  const lx = left % size;
  const ly = Math.floor(left / size);
  const rx = right % size;
  const ry = Math.floor(right / size);
  return Math.abs(lx - rx) + Math.abs(ly - ry) === 1;
}

function serpentinePath(size) {
  const path = [];
  for (let y = 0; y < size; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < size; x++) path.push(y * size + x);
    } else {
      for (let x = size - 1; x >= 0; x--) path.push(y * size + x);
    }
  }
  if (Math.random() < .5) path.reverse();
  return path;
}

/** Backbite moveで全マスを通る一本道を崩し、毎回異なる完成盤を作ります。 */
function randomizedHamiltonianPath(size, mixCount) {
  let path = serpentinePath(size);
  for (let move = 0; move < mixCount; move++) {
    const fromHead = Math.random() < .5;
    if (fromHead) {
      const head = path[0];
      const candidates = [];
      for (let index = 2; index < path.length; index++) {
        if (adjacent(head, path[index], size)) candidates.push(index);
      }
      if (!candidates.length) continue;
      const index = candidates[randomInt(candidates.length)];
      path = [...path.slice(0, index).reverse(), ...path.slice(index)];
    } else {
      const tail = path[path.length - 1];
      const candidates = [];
      for (let index = 0; index < path.length - 2; index++) {
        if (adjacent(tail, path[index], size)) candidates.push(index);
      }
      if (!candidates.length) continue;
      const index = candidates[randomInt(candidates.length)];
      path = [...path.slice(0, index + 1), ...path.slice(index + 1).reverse()];
    }
  }
  return path;
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const next = randomInt(index + 1);
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

function segmentLengths(cellCount, pairCount) {
  const count = Math.max(2, Math.min(pairCount, Math.floor(cellCount / 2)));
  const lengths = Array(count).fill(Math.floor(cellCount / count));
  let rest = cellCount - lengths.reduce((sum, value) => sum + value, 0);
  while (rest-- > 0) lengths[randomInt(lengths.length)]++;
  for (let move = 0; move < count * 2; move++) {
    const from = randomInt(count);
    const to = randomInt(count);
    if (from !== to && lengths[from] > 2 && Math.random() < .55) {
      lengths[from]--;
      lengths[to]++;
    }
  }
  return shuffled(lengths);
}

function segmentsFromPath(path, pairCount) {
  const lengths = segmentLengths(path.length, pairCount);
  const segments = [];
  let cursor = 0;
  lengths.forEach((length) => {
    segments.push(path.slice(cursor, cursor + length));
    cursor += length;
  });
  return segments;
}

function puzzleFromSegments(size, segments) {
  const problemData = Array(size * size).fill(0);
  const solutionEdges = [];
  segments.forEach((segment, index) => {
    const label = index + 1;
    problemData[segment[0]] = label;
    problemData[segment[segment.length - 1]] = label;
    for (let cursor = 1; cursor < segment.length; cursor++) {
      solutionEdges.push(numberlinkEdgeKey(segment[cursor - 1], segment[cursor]));
    }
  });
  return { problemData, solutionEdges };
}

function intendedMatches(solutionEdges, foundEdges) {
  if (solutionEdges.length !== foundEdges.length) return false;
  const found = new Set(foundEdges);
  return solutionEdges.every((edge) => found.has(edge));
}

function qualityAcceptable(segments, difficulty) {
  const lengths = segments.map((segment) => segment.length);
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const shortRatio = lengths.filter((value) => value <= 2).length / lengths.length;
  if (difficulty === "easy") return average >= 2.7;
  if (difficulty === "standard") return average >= 3.5 && shortRatio <= .45;
  if (difficulty === "hard") return average >= 4.8 && shortRatio <= .28;
  return average >= 6 && shortRatio <= .2;
}

function splitLongestSegment(segments) {
  const candidates = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.length >= 4)
    .sort((left, right) => right.segment.length - left.segment.length)
    .slice(0, 3);
  if (!candidates.length) return null;
  const selected = candidates[randomInt(candidates.length)];
  const middle = Math.floor(selected.segment.length / 2);
  const offset = randomInt(3) - 1;
  const cut = Math.max(2, Math.min(selected.segment.length - 2, middle + offset));
  return [
    ...segments.slice(0, selected.index),
    selected.segment.slice(0, cut),
    selected.segment.slice(cut),
    ...segments.slice(selected.index + 1),
  ];
}

export function numberlinkSizeForDifficulty(difficulty = "standard") {
  return (PRESETS[difficulty] || PRESETS.standard).size;
}

export function generateNumberlinkPuzzle(requestedSize, difficulty = "standard", maxAttempts = null) {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const size = Number(requestedSize) || preset.size;
  if (!Number.isInteger(size) || size < 4 || size > 10) return null;
  const scale = (size * size) / (preset.size * preset.size);
  const basePairs = Math.max(4, Math.min(Math.floor(size * size / 2), Math.round(preset.pairs * scale)));
  const attempts = Math.max(4, Math.min(Number(maxAttempts) || preset.attempts, 40));
  const targetBranches = { easy: 0, standard: 1, hard: 2, insane: 4 }[difficulty] || 1;
  let best = null;
  let bestBranches = -1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const path = randomizedHamiltonianPath(size, preset.mix + attempt * 3);
    const pairJitter = difficulty === "easy" ? randomInt(2) : randomInt(3) - 1;
    let segments = segmentsFromPath(path, Math.max(4, basePairs + pairJitter));
    if (!qualityAcceptable(segments, difficulty)) continue;
    const maxRefinements = { easy: 1, standard: 2, hard: 5, insane: 7 }[difficulty] || 2;
    for (let refinement = 0; refinement <= maxRefinements; refinement++) {
      const candidate = puzzleFromSegments(size, segments);
      const result = solveNumberlink(candidate.problemData, size, {
        limit: 2,
        maxNodes: difficulty === "insane" ? 600000 : 350000,
        deadline: (typeof performance !== "undefined" ? performance.now() : Date.now()) + (difficulty === "insane" ? 1500 : 900),
      });
      if (!result.exhausted && result.solutions.length === 1
        && intendedMatches(candidate.solutionEdges, result.solutions[0])) {
        const normalized = normalizeNumberlinkProblem(candidate.problemData, size);
        const generated = {
          problemData: normalized.grid,
          solutionData: {
            edges: result.solutions[0],
            owners: numberlinkSolutionOwners(normalized.grid, size, result.solutions[0]),
          },
          metrics: {
            pairCount: segments.length,
            solverNodes: result.nodes,
            solverBranches: result.branches,
            refinements: refinement,
          },
        };
        if (result.branches >= targetBranches) return generated;
        if (result.branches > bestBranches) {
          best = generated;
          bestBranches = result.branches;
        }
        break;
      }
      const refined = splitLongestSegment(segments);
      if (!refined) break;
      segments = refined;
    }
  }
  if (best) return best;

  // 極端に運が悪い場合も開始不能にしないため、規則的な完成路を細かく分割した一意解を検証して返します。
  const fallbackPath = serpentinePath(size);
  for (let pairCount = Math.max(basePairs, size); pairCount <= Math.min(Math.floor(size * size / 2), basePairs + size); pairCount++) {
    const segments = segmentsFromPath(fallbackPath, pairCount);
    const candidate = puzzleFromSegments(size, segments);
    const result = solveNumberlink(candidate.problemData, size, {
      limit: 2,
      maxNodes: 500000,
      deadline: (typeof performance !== "undefined" ? performance.now() : Date.now()) + 1200,
    });
    if (result.exhausted || result.solutions.length !== 1
      || !intendedMatches(candidate.solutionEdges, result.solutions[0])) continue;
    return {
      problemData: candidate.problemData,
      solutionData: {
        edges: result.solutions[0],
        owners: numberlinkSolutionOwners(candidate.problemData, size, result.solutions[0]),
      },
      metrics: {
        pairCount: segments.length,
        solverNodes: result.nodes,
        solverBranches: result.branches,
        refinements: "fallback",
      },
    };
  }
  return null;
}
