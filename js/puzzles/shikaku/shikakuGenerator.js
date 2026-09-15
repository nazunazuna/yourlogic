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
    const leftArea = (x - rect.x1 + 1) * height;
    const rightArea = (rect.x2 - x) * height;
    if (leftArea >= minArea && rightArea >= minArea) candidates.push({ axis: "x", at: x });
  }
  for (let y = rect.y1; y < rect.y2; y++) {
    const topArea = (y - rect.y1 + 1) * width;
    const bottomArea = (rect.y2 - y) * width;
    if (topArea >= minArea && bottomArea >= minArea) candidates.push({ axis: "y", at: y });
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

export function generateShikakuPuzzle(size, difficulty = "standard") {
  const preset = PRESETS[difficulty] || PRESETS.standard;
  const pending = [{ x1: 0, y1: 0, x2: size - 1, y2: size - 1 }];
  const rectangles = [];

  while (pending.length) {
    const rect = pending.pop();
    const rectArea = area(rect);
    const candidates = possibleSplits(rect, preset.minArea);
    const mustSplit = rectArea > preset.maxArea;
    const maySplit = rectArea >= preset.minArea * 2 && Math.random() < preset.extraSplitChance;

    if (candidates.length && (mustSplit || maySplit)) {
      const centered = candidates.sort((a, b) => {
        const [a1, a2] = split(rect, a).map(area);
        const [b1, b2] = split(rect, b).map(area);
        return Math.abs(a1 - a2) - Math.abs(b1 - b2) + (Math.random() - .5) * 4;
      });
      pending.push(...split(rect, centered[Math.floor(Math.random() * Math.min(4, centered.length))]));
    } else {
      rectangles.push(rect);
    }
  }

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
