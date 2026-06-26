function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function numericParts(version: string) {
  const [core] = normalizeVersion(version).split("-");
  const parts = core.split(".").map((part) => Number(part));
  return parts.every((part) => Number.isInteger(part) && part >= 0) ? parts : null;
}

export function compareVersions(a: string, b: string) {
  const aParts = numericParts(a);
  const bParts = numericParts(b);
  if (!aParts || !bParts) return normalizeVersion(a).localeCompare(normalizeVersion(b));

  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string) {
  return compareVersions(latest, current) > 0;
}
