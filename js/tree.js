// Minimal tree: keep only the nodes needed to tell the recorded organisms apart.
//
// Input: one lineage per organism (root domain first, organism's own taxon last).
// Output: nested object where every internal node is a domain root, a branching
// point, or the first taxon of a branch below a branching point (the one that
// distinguishes the branches); other single-child chains are collapsed onto the edge.
//
// Taxon:    { key, name, rank, name_de }
// Organism: { id, label, lineage: Taxon[], image }

// ranks above species: an organism identified only this far keeps its own taxon node,
// so it sits in the right rank column instead of being merged into the organism leaf
const COARSE = new Set(["domain", "kingdom", "subkingdom", "phylum", "subphylum", "class", "subclass", "order",
  "suborder", "family", "subfamily", "tribe", "genus", "subgenus"]);

const taxonOut = (t) => ({ key: t.key, name: t.name, rank: t.rank, name_de: t.name_de ?? null });

function organismOut(o, collapsed) {
  return {
    type: "organism",
    id: o.id,
    label: o.label,
    image: o.image ?? null,
    taxon: taxonOut(o.lineage[o.lineage.length - 1]),
    collapsed: collapsed.map(taxonOut),
    children: [],
  };
}

// `keep` marks the first taxon of a branch below a split: it is the taxon that
// tells the branches apart, so it stays visible even with a single child.
function emit(node, collapsed, isRoot, keep) {
  if (!isRoot && node.children.size === 0 && node.organisms.length === 1 && !COARSE.has(node.taxon.rank)) {
    // leaf taxon with exactly one organism: show the organism directly
    return organismOut(node.organisms[0], collapsed);
  }
  if (!isRoot && !keep && node.organisms.length === 0 && node.children.size === 1) {
    // pure pass-through node: fold it into the edge
    const [child] = node.children.values();
    return emit(child, [...collapsed, node.taxon], false, false);
  }
  const splits = node.children.size + node.organisms.length >= 2;
  const children = [...node.children.values()].map((c) => emit(c, [], false, splits));
  children.push(...node.organisms.map((o) => organismOut(o, [])));
  children.sort((a, b) =>
    (a.type === "organism") - (b.type === "organism") || cmp(a.taxon.name, b.taxon.name));
  return { type: "taxon", taxon: taxonOut(node.taxon), collapsed: collapsed.map(taxonOut), children };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function buildTree(organisms) {
  const roots = new Map();
  for (const o of organisms) {
    if (!o.lineage?.length) continue;
    let level = roots, node = null;
    for (const t of o.lineage) {
      node = level.get(t.key);
      if (!node) level.set(t.key, (node = { taxon: t, children: new Map(), organisms: [] }));
      level = node.children;
    }
    node.organisms.push(o);
  }
  if (roots.size === 0) return null;
  const trees = [...roots.values()].map((r) => emit(r, [], true, true));
  if (trees.length === 1) return trees[0];
  return {
    type: "taxon",
    taxon: { key: "life", name: "Leben", rank: "root", name_de: null },
    collapsed: [],
    children: trees.sort((a, b) => cmp(a.taxon.name, b.taxon.name)),
  };
}
