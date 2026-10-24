/**
 * The torn edge of a stub, generated from the deal id and tranche index so the
 * stub and the document it came from share the same edge, and no two stubs tear alike.
 */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function tearPoints(seed: string, teeth = 34, depth = 6): Array<[number, number]> {
  const r = rng(seed);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * 100;
    const y = i % 2 === 0 ? r() * depth * 0.45 : depth * (0.55 + r() * 0.45);
    pts.push([x, y]);
  }
  return pts;
}

/** clip-path for an element whose top edge is torn. */
export function tornTop(seed: string): string {
  const edge = tearPoints(seed).map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}px`);
  return `polygon(${edge.join(", ")}, 100% 100%, 0% 100%)`;
}

/** The same edge before it tears: identical point count, so the clip-path can tween between the two. */
export function straightTop(seed: string): string {
  const edge = tearPoints(seed).map(([x]) => `${x.toFixed(2)}% 0px`);
  return `polygon(${edge.join(", ")}, 100% 100%, 0% 100%)`;
}
