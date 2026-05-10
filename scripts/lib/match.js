export const STOP_TOKENS = new Set([
  "bier","wein","sauce","salat","käse","käswurst","fleisch","fisch","milch","brot","wurst","eis","saft","tee",
  "wiener","bayrisch","tiroler","steirisch",
  "frisch","frische","frischer","scheiben","scheibe","schnitten","schnitte","boxen","box",
  "mariniert","gewürzt","geräuchert",
]);

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
  const needleTokens = tokenize(articleName).filter(t => t.length >= 4);
  if (!needleTokens.length) return false;

  const haystackStems = tokenize(fullText).map(pluralStem);
  const needleStems   = needleTokens.map(pluralStem);

  // Rule A: full phrase — all needle stems as contiguous subsequence
  const phraseMatch = haystackStems.some((_, i) =>
    needleStems.every((ns, j) => haystackStems[i + j] === ns)
  );
  if (phraseMatch) return true;

  // Rule C: multi-token items only
  if (needleTokens.length >= 2) {
    // first token (brand heuristic): >=4 chars AND not in stop list
    if (needleTokens[0].length >= 4 && !STOP_TOKENS.has(needleTokens[0]) && haystackStems.includes(needleStems[0])) return true;
    // last token (category): >=5 chars AND not in stop list
    const lastToken = needleTokens[needleTokens.length - 1];
    const lastStem  = needleStems[needleTokens.length - 1];
    if (lastToken.length >= 5 && !STOP_TOKENS.has(lastToken) && haystackStems.includes(lastStem)) return true;
  }

  return false;
}
