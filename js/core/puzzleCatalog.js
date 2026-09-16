export const PUZZLE_GENRES = Object.freeze([
  {
    id: "pencil-number",
    label: "ペンシルナンバーパズル",
    description: "図示された問題に対し、少しずつ書き込んでいくことによって答えの状態を導く数字のパズル。",
  },
  {
    id: "pencil-word",
    label: "ペンシルワードパズル",
    description: "図示された問題に対し、少しずつ書き込んでいくことによって答えの状態を導く言葉のパズル。",
  },
  {
    id: "logic",
    label: "ロジックパズル",
    description: "文章で説明される状況などから、論理的に矛盾無くあてはまる1通りのパターンを見つけ出すパズル。",
  },
  {
    id: "calculation",
    label: "計算パズル",
    description: "過程として計算を必要とするパズル。計算過程が最もメインとなるパズル。",
  },
  {
    id: "board-game",
    label: "ボードゲームパズル",
    description: "将棋やチェスなど、実際にあるボードゲームを使用したパズル。",
  },
  {
    id: "mechanical",
    label: "メカニカルパズル",
    description: "実際のなんらかのパーツを動かし、正解の状況まで導くパズル。",
  },
  {
    id: "abstract",
    label: "アブストラクトゲーム",
    description: "運要素も、自分だけの秘密要素も、反射神経要素もない、完全実力勝負による対戦ゲーム。二人以上必要。",
  },
  { id: "other", label: "その他", description: "" },
]);

const genreById = new Map(PUZZLE_GENRES.map((genre) => [genre.id, genre]));
const japaneseCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function getPuzzleGenre(id) {
  return genreById.get(id) || genreById.get("other");
}

export function normalizePuzzleSearch(value = "") {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("ja");
}

function searchableText(puzzle) {
  const genreText = (puzzle.genres || []).flatMap((id) => {
    const genre = getPuzzleGenre(id);
    return [genre.label, genre.description];
  });
  return normalizePuzzleSearch([
    puzzle.name,
    puzzle.subtitle,
    puzzle.description,
    ...(puzzle.keywords || []),
    ...genreText,
  ].filter(Boolean).join(" "));
}

export function filterAndSortPuzzles(puzzles, options = {}) {
  const query = normalizePuzzleSearch(options.query);
  const genre = options.genre || "all";
  const sort = options.sort || "default";
  const filtered = puzzles.filter((puzzle) => {
    if (genre !== "all" && !(puzzle.genres || []).includes(genre)) return false;
    if (query && !searchableText(puzzle).includes(query)) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    if (sort === "name-asc") return japaneseCollator.compare(left.name, right.name);
    if (sort === "name-desc") return japaneseCollator.compare(right.name, left.name);
    return Number(left.order || 0) - Number(right.order || 0);
  });
}
