// Shared, immutable patch protocol. String append patches make streamed tokens cheap.
export function diffState(before, after, path = [], patches = []) {
  if (Object.is(before, after)) return patches;
  if (
    typeof before === "string" &&
    typeof after === "string" &&
    after.startsWith(before)
  ) {
    patches.push({ path, append: after.slice(before.length) });
    return patches;
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    if (Array.isArray(after)) {
      const sameOrder =
        after.length >= before.length &&
        before.every((v, i) => !v?.id || v.id === after[i]?.id);
      if (!sameOrder) {
        patches.push({ path, value: after });
        return patches;
      }
      for (let i = 0; i < after.length; i++)
        if (i < before.length)
          diffState(before[i], after[i], [...path, i], patches);
        else patches.push({ path: [...path, i], value: after[i] });
    } else {
      for (const key of Object.keys(before))
        if (!(key in after))
          patches.push({ path: [...path, key], remove: true });
      for (const key of Object.keys(after))
        diffState(before[key], after[key], [...path, key], patches);
    }
    return patches;
  }
  patches.push({ path, value: after });
  return patches;
}
export function applyPatches(state, patches) {
  const update = (node, path, patch) => {
    if (!path.length)
      return patch.append !== undefined
        ? (node || "") + patch.append
        : patch.value;
    const [key, ...tail] = path;
    if (["__proto__", "prototype", "constructor"].includes(String(key)))
      throw new Error("Invalid update path");
    const copy = Array.isArray(node) ? [...node] : { ...node };
    if (!tail.length && patch.remove) delete copy[key];
    else copy[key] = update(node?.[key], tail, patch);
    return copy;
  };
  return patches.reduce((value, p) => update(value, p.path, p), state);
}
