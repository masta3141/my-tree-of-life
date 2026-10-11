// GBIF backbone lookup: scientific name -> lineage (domain first).

const API = "https://api.gbif.org/v1";
const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"];

export const KINGDOM_TO_DOMAIN = {
  Animalia: "Eukaryota",
  Plantae: "Eukaryota",
  Fungi: "Eukaryota",
  Protozoa: "Eukaryota",
  Chromista: "Eukaryota",
  Bacteria: "Bacteria",
  Archaea: "Archaea",
  Viruses: "Viruses",
};

export const domainTaxon = (name) => ({ key: `dom:${name}`, name, rank: "domain", name_de: null });

// Returns { lineage, match_type, confidence, rank } or null.
export async function match(name) {
  const r = await fetch(`${API}/species/match?${new URLSearchParams({ name, verbose: "false" })}`);
  if (!r.ok) throw new Error(`GBIF: ${r.status}`);
  const d = await r.json();
  if (d.matchType === "NONE" || !d.kingdom) return null;

  const domain = KINGDOM_TO_DOMAIN[d.kingdom];
  const lineage = domain ? [domainTaxon(domain)] : [];
  for (const rank of RANKS) {
    if (d[rank] && d[`${rank}Key`]) lineage.push({ key: String(d[`${rank}Key`]), name: d[rank], rank, name_de: null });
  }
  // infraspecific matches (subspecies, variety, ...) sit below species
  const leafKey = String(d.acceptedUsageKey || d.usageKey);
  if (d.status === "ACCEPTED" && leafKey !== lineage[lineage.length - 1].key) {
    lineage.push({ key: leafKey, name: d.canonicalName || d.scientificName, rank: d.rank.toLowerCase(), name_de: null });
  }
  return { lineage, match_type: d.matchType, confidence: d.confidence, rank: (d.rank || "").toLowerCase() };
}
