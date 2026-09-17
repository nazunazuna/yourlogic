import {
  normalizeNumberlinkProblem,
  numberlinkEdgeKey,
  numberlinkSolutionOwners,
  parseNumberlinkEdge,
  solveNumberlink,
} from "./numberlinkSolver.js?v=20260918-1";

export function numberlinkPathsToEdges(paths = {}) {
  const edges = [];
  Object.values(paths || {}).forEach((path) => {
    if (!Array.isArray(path)) return;
    for (let index = 1; index < path.length; index++) {
      edges.push(numberlinkEdgeKey(path[index - 1], path[index]));
    }
  });
  return Array.from(new Set(edges));
}

function rowColumn(cell, size) {
  return { x: cell % size, y: Math.floor(cell / size) };
}

function isCompleted(problem, size, fixedEdges, solutionEdges) {
  if (fixedEdges.length !== solutionEdges.length) return false;
  const selected = new Set(fixedEdges);
  return solutionEdges.every((edge) => selected.has(edge))
    && normalizeNumberlinkProblem(problem, size).grid.every((_, cell) => {
      const degree = solutionEdges.filter((edge) => parseNumberlinkEdge(edge).includes(cell)).length;
      return degree > 0;
    });
}

/** 保存済み解答は参照せず、盤面・ルール・現在の入力だけから次の確定線を探します。 */
export function getNumberlinkHint(problemData, size, paths = {}) {
  const normalized = normalizeNumberlinkProblem(problemData, size);
  if (!normalized.size) return { tone: "error", message: "盤面データを読み取れませんでした。" };
  const fixedEdges = numberlinkPathsToEdges(paths);
  const result = solveNumberlink(normalized.grid, normalized.size, {
    limit: 2,
    fixedEdges,
    maxNodes: 500000,
    deadline: (typeof performance !== "undefined" ? performance.now() : Date.now()) + 1800,
  });
  if (result.exhausted) {
    return { tone: "error", message: "この盤面のヒント計算に時間がかかっています。少し線を進めてから、もう一度お試しください。" };
  }
  if (!result.solutions.length) {
    return {
      tone: "error",
      message: "現在の線を残したまま完成できません。交差している線や、行き止まりになった線を一つ戻してください。",
    };
  }
  const solution = result.solutions[0];
  if (isCompleted(normalized.grid, normalized.size, fixedEdges, solution)) {
    return { tone: "success", message: "線は正しく完成しています。答え合わせをしてみましょう。" };
  }

  const fixed = new Set(fixedEdges);
  let nextEdge = null;
  for (const path of Object.values(paths || {})) {
    if (!Array.isArray(path) || !path.length) continue;
    const frontier = Number(path[path.length - 1]);
    nextEdge = solution.find((edge) => !fixed.has(edge) && parseNumberlinkEdge(edge).includes(frontier));
    if (nextEdge) break;
  }
  nextEdge ||= solution.find((edge) => !fixed.has(edge));
  if (!nextEdge) return { tone: "success", message: "入力済みの線を確認して、答え合わせをしてみましょう。" };
  const [left, right] = parseNumberlinkEdge(nextEdge);
  const owners = numberlinkSolutionOwners(normalized.grid, normalized.size, solution);
  const label = owners[left] || owners[right] || "同じ数字";
  const cells = [rowColumn(left, normalized.size), rowColumn(right, normalized.size)];

  return {
    tone: "hint",
    edge: nextEdge,
    cells,
    label,
    logicName: "線の本数と行き止まり",
    focusCells: cells,
    focusMessage: `「${label}」の線と、ハイライトした2マスの周囲に注目してください。`,
    message: `各マスを1本の線で通り、途中のマスから線が2方向へ続くように考えると、黄色の2マスは「${label}」の線で結ばれます。`,
  };
}
