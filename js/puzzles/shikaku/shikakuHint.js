function sameRect(a, b) {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

function valuesInRect(rect, board) {
  const values = [];
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      if (board[y][x] > 0) values.push({ value: board[y][x], x, y });
    }
  }
  return values;
}

export function getShikakuHint(userRects, board, solution) {
  for (const rect of userRects) {
    const numbers = valuesInRect(rect, board);
    const area = (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
    if (numbers.length !== 1) {
      return { tone: "error", rect, message: "数字が1つだけ入るように、赤い範囲を引き直してみましょう。" };
    }
    if (numbers[0].value !== area) {
      return { tone: "error", rect, message: `この範囲の面積は ${area} です。数字の ${numbers[0].value} と一致する大きさに直しましょう。` };
    }
    if (!solution.some((answer) => sameRect(rect, answer))) {
      return { tone: "error", rect, message: "ルールには合っていますが、この問題の解答とは異なる範囲です。赤い範囲を見直してみましょう。" };
    }
  }

  const next = solution.find((answer) => !userRects.some((rect) => sameRect(rect, answer)));
  if (!next) return { tone: "success", rect: null, message: "すべての四角形が正しく完成しています。答え合わせを押してみましょう。" };
  const number = valuesInRect(next, board)[0];
  return {
    tone: "hint",
    rect: next,
    number,
    message: `${number.y + 1}行${number.x + 1}列の「${number.value}」に注目してください。黄色い範囲まで広げると面積が一致します。`,
  };
}
