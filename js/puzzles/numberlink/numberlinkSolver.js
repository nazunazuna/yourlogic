function normalizedSize(value) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 2 ? size : 0;
}

export function normalizeNumberlinkProblem(problemData, requestedSize = 0) {
  const source = problemData?.grid ?? problemData;
  const size = normalizedSize(requestedSize || problemData?.size || (Array.isArray(source) ? source.length : 0));
  if (!size || !Array.isArray(source)) return { size: 0, grid: [] };
  const grid = Array.isArray(source[0]) ? source.flat() : [...source];
  if (grid.length !== size * size) return { size: 0, grid: [] };
  return {
    size,
    grid: grid.map((value) => Math.max(0, Number(value) || 0)),
  };
}

export function numberlinkEdgeKey(left, right) {
  const a = Number(left);
  const b = Number(right);
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function parseNumberlinkEdge(value) {
  const [left, right] = String(value).split(":").map(Number);
  return [left, right];
}

export function buildNumberlinkGraph(size) {
  const edges = [];
  const incident = Array.from({ length: size * size }, () => []);
  const add = (left, right) => {
    const id = edges.length;
    edges.push({ id, left, right, key: numberlinkEdgeKey(left, right) });
    incident[left].push(id);
    incident[right].push(id);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = y * size + x;
      if (x + 1 < size) add(cell, cell + 1);
      if (y + 1 < size) add(cell, cell + size);
    }
  }
  return { edges, incident };
}

function endpointPairs(grid) {
  const pairs = new Map();
  grid.forEach((label, cell) => {
    if (!label) return;
    if (!pairs.has(label)) pairs.set(label, []);
    pairs.get(label).push(cell);
  });
  if (!pairs.size || [...pairs.values()].some((cells) => cells.length !== 2)) return null;
  return pairs;
}

function combinations(values, count) {
  if (count === 0) return [[]];
  if (count > values.length) return [];
  const result = [];
  const visit = (start, selected) => {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (count - selected.length); index++) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function createComponents(cellCount, edges, state, grid) {
  const parent = Int16Array.from({ length: cellCount }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const unite = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a === b) return false;
    parent[b] = a;
    return true;
  };

  for (let edgeId = 0; edgeId < edges.length; edgeId++) {
    if (state[edgeId] !== 1) continue;
    const edge = edges[edgeId];
    if (!unite(edge.left, edge.right)) return { invalid: true };
  }

  const endpointLabels = new Map();
  for (let cell = 0; cell < cellCount; cell++) {
    const root = find(cell);
    if (!endpointLabels.has(root)) endpointLabels.set(root, []);
    if (grid[cell]) endpointLabels.get(root).push(grid[cell]);
  }
  for (const labels of endpointLabels.values()) {
    if (labels.length > 2) return { invalid: true };
    if (labels.length === 2 && labels[0] !== labels[1]) return { invalid: true };
  }
  return { invalid: false, parent, find, endpointLabels };
}

function labelsCanMerge(leftLabels, rightLabels) {
  const labels = [...leftLabels, ...rightLabels];
  return labels.length <= 2 && (labels.length < 2 || labels[0] === labels[1]);
}

function pairReachable(start, target, edges, incident, state) {
  const seen = new Uint8Array(incident.length);
  const queue = [start];
  seen[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    if (cell === target) return true;
    for (const edgeId of incident[cell]) {
      if (state[edgeId] === 0) continue;
      const edge = edges[edgeId];
      const next = edge.left === cell ? edge.right : edge.left;
      if (!seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return false;
}

function validateCompleted(grid, edges, state) {
  const components = createComponents(grid.length, edges, state, grid);
  if (components.invalid) return false;
  for (let cell = 0; cell < grid.length; cell++) {
    const labels = components.endpointLabels.get(components.find(cell)) || [];
    if (labels.length !== 2 || labels[0] !== labels[1]) return false;
  }
  return true;
}

/**
 * 線の有無を辺変数として解きます。端点の次数は1、それ以外は2です。
 * 閉路・別数字同士の接続・到達不能を枝刈りし、limit件まで完成解を返します。
 */
export function solveNumberlink(problemData, requestedSize, options = {}) {
  const normalized = normalizeNumberlinkProblem(problemData, requestedSize);
  const { size, grid } = normalized;
  const pairs = endpointPairs(grid);
  if (!size || !pairs) {
    return { solutions: [], exhausted: false, nodes: 0, branches: 0, forced: 0, reason: "invalid-problem" };
  }

  const { edges, incident } = buildNumberlinkGraph(size);
  const edgeByKey = new Map(edges.map((edge) => [edge.key, edge.id]));
  const initial = new Int8Array(edges.length);
  initial.fill(-1);
  const fixedEdges = options.fixedEdges || [];
  const blockedEdges = options.blockedEdges || [];
  for (const key of fixedEdges) {
    const edgeId = edgeByKey.get(String(key));
    if (edgeId === undefined || initial[edgeId] === 0) {
      return { solutions: [], exhausted: false, nodes: 0, branches: 0, forced: 0, reason: "invalid-fixed-edge" };
    }
    initial[edgeId] = 1;
  }
  for (const key of blockedEdges) {
    const edgeId = edgeByKey.get(String(key));
    if (edgeId === undefined || initial[edgeId] === 1) {
      return { solutions: [], exhausted: false, nodes: 0, branches: 0, forced: 0, reason: "invalid-blocked-edge" };
    }
    initial[edgeId] = 0;
  }

  const required = grid.map((label) => label ? 1 : 2);
  const limit = Math.max(1, Number(options.limit) || 2);
  const maxNodes = Math.max(1, Number(options.maxNodes) || 250000);
  const deadline = Number(options.deadline) || ((typeof performance !== "undefined" ? performance.now() : Date.now()) + 2500);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const solutions = [];
  let nodes = 0;
  let branches = 0;
  let forced = 0;
  let exhausted = false;

  function setState(state, edgeId, value) {
    if (state[edgeId] === value) return true;
    if (state[edgeId] !== -1) return false;
    state[edgeId] = value;
    forced++;
    return true;
  }

  function propagate(state) {
    let changed = true;
    while (changed) {
      if (nodes > maxNodes || now() > deadline) {
        exhausted = true;
        return false;
      }
      changed = false;

      for (let cell = 0; cell < grid.length; cell++) {
        let on = 0;
        const undecided = [];
        for (const edgeId of incident[cell]) {
          if (state[edgeId] === 1) on++;
          else if (state[edgeId] === -1) undecided.push(edgeId);
        }
        const need = required[cell] - on;
        if (need < 0 || need > undecided.length) return false;
        if (need === 0) {
          for (const edgeId of undecided) {
            if (!setState(state, edgeId, 0)) return false;
            changed = true;
          }
        } else if (need === undecided.length) {
          for (const edgeId of undecided) {
            if (!setState(state, edgeId, 1)) return false;
            changed = true;
          }
        }
      }

      const components = createComponents(grid.length, edges, state, grid);
      if (components.invalid) return false;
      for (const edge of edges) {
        if (state[edge.id] !== -1) continue;
        const leftRoot = components.find(edge.left);
        const rightRoot = components.find(edge.right);
        const leftLabels = components.endpointLabels.get(leftRoot) || [];
        const rightLabels = components.endpointLabels.get(rightRoot) || [];
        if (leftRoot === rightRoot || !labelsCanMerge(leftLabels, rightLabels)) {
          if (!setState(state, edge.id, 0)) return false;
          changed = true;
        }
      }

      for (const cells of pairs.values()) {
        if (!pairReachable(cells[0], cells[1], edges, incident, state)) return false;
      }
    }
    return true;
  }

  function selectBranch(state) {
    let best = null;
    for (let cell = 0; cell < grid.length; cell++) {
      let on = 0;
      const undecided = [];
      incident[cell].forEach((edgeId) => {
        if (state[edgeId] === 1) on++;
        else if (state[edgeId] === -1) undecided.push(edgeId);
      });
      const need = required[cell] - on;
      if (need <= 0 || !undecided.length) continue;
      const choices = combinations(undecided, need);
      const score = choices.length * 10 + undecided.length + (grid[cell] ? -4 : 0);
      if (!best || score < best.score) best = { cell, undecided, choices, score };
    }
    return best;
  }

  function search(source) {
    if (solutions.length >= limit || exhausted) return;
    if (++nodes > maxNodes || now() > deadline) {
      exhausted = true;
      return;
    }
    const state = new Int8Array(source);
    if (!propagate(state)) return;

    const branch = selectBranch(state);
    if (!branch) {
      if (!validateCompleted(grid, edges, state)) return;
      solutions.push(edges.filter((edge) => state[edge.id] === 1).map((edge) => edge.key));
      return;
    }

    branches++;
    for (const chosen of branch.choices) {
      const next = new Int8Array(state);
      const selected = new Set(chosen);
      let valid = true;
      for (const edgeId of branch.undecided) {
        const value = selected.has(edgeId) ? 1 : 0;
        if (next[edgeId] !== -1 && next[edgeId] !== value) { valid = false; break; }
        next[edgeId] = value;
      }
      if (valid) search(next);
      if (solutions.length >= limit || exhausted) return;
    }
  }

  search(initial);
  return { solutions, exhausted, nodes, branches, forced, reason: exhausted ? "limit" : null };
}

export function numberlinkSolutionOwners(problemData, requestedSize, solutionEdges) {
  const { size, grid } = normalizeNumberlinkProblem(problemData, requestedSize);
  if (!size) return [];
  const { edges } = buildNumberlinkGraph(size);
  const selected = new Set(solutionEdges || []);
  const neighbors = Array.from({ length: grid.length }, () => []);
  edges.forEach((edge) => {
    if (!selected.has(edge.key)) return;
    neighbors[edge.left].push(edge.right);
    neighbors[edge.right].push(edge.left);
  });
  const owners = Array(grid.length).fill(0);
  grid.forEach((label, start) => {
    if (!label || owners[start]) return;
    const queue = [start];
    owners[start] = label;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor];
      neighbors[cell].forEach((next) => {
        if (!owners[next]) {
          owners[next] = label;
          queue.push(next);
        }
      });
    }
  });
  return owners;
}
