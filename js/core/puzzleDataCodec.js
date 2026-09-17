function normalizedSize(size) {
  const value = Number(size);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Firestoreでは配列の中に配列を保存できないため、盤面だけを行優先の1次元配列にします。 */
export function flattenShikakuBoard(board, size) {
  if (!Array.isArray(board)) return board;
  if (!Array.isArray(board[0])) return [...board];

  const side = normalizedSize(size);
  if (!side || board.length !== side || board.some((row) => !Array.isArray(row) || row.length !== side)) {
    throw new Error("四角に切れの盤面サイズと問題データが一致しません。");
  }
  return board.flat();
}

/** Firestoreから取得した1次元盤面を、ゲームが利用する行列へ戻します。 */
export function inflateShikakuBoard(board, size) {
  if (!Array.isArray(board) || Array.isArray(board[0])) return board;
  const side = normalizedSize(size);
  if (!side || board.length !== side * side) return board;
  return Array.from({ length: side }, (_, row) => board.slice(row * side, (row + 1) * side));
}

export function encodePuzzleDataForFirestore({ type, size, problemData, solutionData, parameters = {} }) {
  if (type === "numberlink") {
    const side = normalizedSize(size);
    const grid = Array.isArray(problemData?.[0]) ? problemData.flat() : [...(problemData || [])];
    if (!side || grid.length !== side * side) throw new Error("ナンバーリンクの盤面サイズと問題データが一致しません。");
    return {
      problemData: grid,
      solutionData: {
        edges: Array.isArray(solutionData?.edges) ? [...solutionData.edges] : [],
        owners: Array.isArray(solutionData?.owners) ? [...solutionData.owners] : [],
      },
      parameters: { ...parameters, problemEncoding: "flat-row-major" },
    };
  }
  if (type !== "shikaku") return { problemData, solutionData, parameters };
  return {
    problemData: flattenShikakuBoard(problemData, size),
    solutionData,
    parameters: { ...parameters, problemEncoding: "flat-row-major" },
  };
}

export function decodePuzzleDataFromFirestore(puzzle) {
  if (puzzle?.type === "numberlink") {
    const problemData = puzzle.problemData ?? puzzle.puzzleData;
    return {
      ...puzzle,
      problemData: Array.isArray(problemData?.[0]) ? problemData.flat() : problemData,
      solutionData: puzzle.solutionData || { edges: [], owners: [] },
    };
  }
  if (!puzzle || puzzle.type !== "shikaku") return puzzle;
  const problemData = puzzle.problemData ?? puzzle.puzzleData;
  const solutionData = puzzle.solutionData ?? puzzle.solutionRects;
  return {
    ...puzzle,
    problemData: inflateShikakuBoard(problemData, puzzle.size),
    solutionData,
  };
}
