const numberFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return numberFmt.format(Math.round(n));
}

export function fmtCompact(n: number): string {
  return compactFmt.format(n);
}

export function fmtBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Signed percent for deltas, e.g. +12.3% / -4.0%. */
export function fmtDelta(ratio: number | undefined): { text: string; dir: "up" | "down" | "flat" } {
  if (ratio === undefined || !Number.isFinite(ratio) || Math.abs(ratio) < 0.0005) {
    return { text: "0%", dir: "flat" };
  }
  const dir = ratio > 0 ? "up" : "down";
  const sign = ratio > 0 ? "+" : "";
  return { text: `${sign}${(ratio * 100).toFixed(1)}%`, dir };
}

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < hr) return RELATIVE.format(Math.round(diff / min), "minute");
  if (abs < day) return RELATIVE.format(Math.round(diff / hr), "hour");
  return RELATIVE.format(Math.round(diff / day), "day");
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function fmtTimeAxis(iso: string, spanMs: number): string {
  const d = new Date(iso);
  if (spanMs <= 36 * 3600_000) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
export function flagEmoji(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return "🏳️";
  const cp = [...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp);
}
export function countryName(iso2: string): string {
  try {
    return REGION_NAMES.of(iso2.toUpperCase()) ?? iso2;
  } catch {
    return iso2;
  }
}
