// Strip a leading "v" and split off an optional pre-release / build suffix.
//   "v2026.7.1-beta.6" -> { core: [2026, 7, 1], pre: "beta.6", build: undefined }
//   "2026.7.1"         -> { core: [2026, 7, 1], pre: undefined,    build: undefined }
export function splitSemver(raw: string): { core: number[]; pre?: string; build?: string } {
  const stripped = raw.replace(/^v/, "");
  const [main, ...rest] = stripped.split("+");
  const build = rest.length ? rest.join("+") : undefined;
  const [corePart, ...preParts] = main.split("-");
  const pre = preParts.length ? preParts.join("-") : undefined;
  const core = corePart.split(".").map((n) => {
    const num = parseInt(n, 10);
    return Number.isFinite(num) ? num : 0;
  });
  return { core, pre, build };
}

// Compare two semver-like version strings.
// Returns a negative number when `a` is OLDER than `b`, so the result is
// suitable for direct use with `Array.prototype.sort` (ascending order).
// Follows the SemVer 2.0.0 ordering rule:
//   1. Compare the dotted core (major.minor.patch[. ...]) numerically.
//   2. A version WITHOUT a pre-release has higher precedence than one WITH
//      a pre-release at the same core (so 2026.7.1 > 2026.7.1-beta.6).
//   3. When both have a pre-release, compare them dot-by-dot, and each dot
//      segment as a number when both are numeric, otherwise lexicographically.
export function compareSemverAsc(a: string, b: string): number {
  const A = splitSemver(a);
  const B = splitSemver(b);

  const len = Math.max(A.core.length, B.core.length);
  for (let i = 0; i < len; i++) {
    // Newer (A) has a higher core value: A.core - B.core
    const diff = (A.core[i] ?? 0) - (B.core[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Core tuples are equal — apply pre-release precedence.
  // A is newer when A has NO pre-release OR has a "greater" pre-release.
  if (!A.pre && B.pre) return 1;  // A is stable, B is pre-release -> A newer
  if (A.pre && !B.pre) return -1; // B is stable, A is pre-release -> B newer
  if (A.pre && B.pre) {
    const aParts = A.pre.split(".");
    const bParts = B.pre.split(".");
    const pLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < pLen; i++) {
      if (aParts[i] === undefined) return -1; // A has fewer segments -> older
      if (bParts[i] === undefined) return 1;  // B has fewer segments -> older
      const aNum = /^\d+$/.test(aParts[i]) ? parseInt(aParts[i], 10) : null;
      const bNum = /^\d+$/.test(bParts[i]) ? parseInt(bParts[i], 10) : null;
      if (aNum !== null && bNum !== null) {
        if (aNum !== bNum) return aNum - bNum; // larger numeric = newer
      } else {
        // Numeric identifiers always have lower precedence than non-numeric,
        // and non-numeric identifiers sort lexicographically (ASCII).
        if (aNum !== null) return -1; // A is numeric, B is string -> A older
        if (bNum !== null) return 1;  // B is numeric, A is string -> B older
        const cmp = aParts[i].localeCompare(bParts[i]);
        if (cmp !== 0) return cmp;
      }
    }
  }
  return 0;
}
