function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * パズル共通の一手戻し履歴。
 * 今後追加するパズルも、操作直前の状態を record() するだけで利用できます。
 */
export function createUndoHistory({ apply, limit = 200, onChange = () => {} }) {
  const stack = [];

  function notify() {
    onChange({ canUndo: stack.length > 0, length: stack.length });
  }

  return {
    record(snapshot) {
      stack.push(clone(snapshot));
      if (stack.length > limit) stack.splice(0, stack.length - limit);
      notify();
    },
    undo() {
      if (!stack.length) return false;
      apply(clone(stack.pop()));
      notify();
      return true;
    },
    clear() {
      stack.length = 0;
      notify();
    },
    get canUndo() {
      return stack.length > 0;
    },
  };
}

export function bindUndoShortcut(target, undo) {
  const listener = (event) => {
    const isUndo = (event.metaKey || event.ctrlKey)
      && !event.altKey
      && !event.shiftKey
      && event.key.toLowerCase() === "z";
    if (!isUndo) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    undo();
  };
  target.addEventListener("keydown", listener, true);
  return () => target.removeEventListener("keydown", listener, true);
}
