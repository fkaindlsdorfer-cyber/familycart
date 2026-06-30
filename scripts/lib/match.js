export const STOP_TOKENS = new Set([
  "bier","wein","sauce","salat","käse","käswurst","fleisch","fisch","milch","brot","wurst","eis","saft","tee",
  "wiener","bayrisch","tiroler","steirisch",
  "frisch","frische","frischer","scheiben","scheibe","schnitten","schnitte","boxen","box",
  "mariniert","gewürzt","geräuchert",
]);

const SYNONYM_GROUPS = {
  nudel:     ["nudel", "nudeln", "teigware", "teigwaren", "pasta"],
  kartoffel: ["kartoffel", "kartoffeln", "erdaepfel", "erdapfel", "erdaepful"],
  tomate:    ["tomate", "tomaten", "paradeiser"],
  obers:     ["obers", "schlagobers", "sahne", "schlagsahne"],
  aubergine: ["aubergine", "auberginen", "melanzani"],
};
const SYNONYM_CANONICAL = (() => {
  const m = new Map();
  for (const [canon, words] of Object.entries(SYNONYM_GROUPS)) {
    for (const w of words) m.set(w, canon);
  }
  return m;
})();
function canonicalize(token) {
  return SYNONYM_CANONICAL.get(token) || token;
}

// only en/n/s — no -e, to prevent "spare"→"spar" matching "SPAR"
export function pluralStem(s) {
  if (s.length > 4 && s.endsWith("en")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("n"))  return s.slice(0, -1);
  if (s.length > 3 && s.endsWith("s"))  return s.slice(0, -1);
  return s;
}

function tokenize(str) {
  return (str || "").toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

export function matchesArticleName(articleName, fullText) {
  // length-checks (Rule C) operate on ORIGINAL tokens, not the canonicalized form
  const needleOriginal = tokenize(articleName).filter(t => t.length >= 4);
  if (!needleOriginal.length) return false;
  const needleTokens = needleOriginal.map(canonicalize);

  const haystackStems = tokenize(fullText).map(canonicalize).map(pluralStem);
  const needleStems   = needleTokens.map(pluralStem);

  // Rule A: full phrase — all needle stems as contiguous subsequence
  const phraseMatch = haystackStems.some((_, i) =>
    needleStems.every((ns, j) => haystackStems[i + j] === ns)
  );
  if (phraseMatch) return true;

  // Rule C: multi-token items only
  if (needleOriginal.length >= 2) {
    // first token (brand heuristic): >=4 chars (original) AND not in stop list
    if (needleOriginal[0].length >= 4 && !STOP_TOKENS.has(needleOriginal[0]) && haystackStems.includes(needleStems[0])) return true;
    // last token (category): >=5 chars (original) AND not in stop list
    const lastTokenOriginal = needleOriginal[needleOriginal.length - 1];
    const lastStem          = needleStems[needleOriginal.length - 1];
    if (lastTokenOriginal.length >= 5 && !STOP_TOKENS.has(lastTokenOriginal) && haystackStems.includes(lastStem)) return true;
  }

  return false;
}
