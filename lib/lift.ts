import type { TopNRow } from "@/lib/domain/types";

/**
 * Lift analysis: "what's over-represented during an incident vs normal".
 *
 * Given the same breakdown dimension computed over two windows - the incident
 * window and a baseline window - we compare each value's SHARE of traffic in
 * each window. A value whose share is much higher during the incident than at
 * baseline is a suspect (e.g. one client IP that is 3% of normal traffic but
 * 60% during a 4xx spike). This is the same idea as Cloudflare Radar's
 * "what changed" - purely a function of two Top-N result sets, so it runs
 * identically on real AFD (Log Analytics), ClickHouse and mock data.
 */

export interface LiftRow {
  key: string;
  label: string;
  /** Requests in the incident window. */
  incidentRequests: number;
  /** Requests in the baseline window. */
  baselineRequests: number;
  /** Fraction of incident-window requests (0..1). */
  incidentShare: number;
  /** Fraction of baseline-window requests (0..1). */
  baselineShare: number;
  /**
   * Share ratio incidentShare / baselineShare. > 1 means over-represented
   * during the incident; Infinity when the value is new (absent at baseline).
   */
  lift: number;
  /** Signed percentage-point change in share (incident - baseline), x100. */
  sharePointDelta: number;
  /** True when the value is present in the incident window but not the baseline. */
  isNew: boolean;
}

export interface LiftOptions {
  /** Ignore values contributing less than this share of the incident window. Default 0.01. */
  minIncidentShare?: number;
  /** Smoothing added to both shares before the ratio, to tame tiny denominators. Default 0.001. */
  smoothing?: number;
  /** Only surface values at/above this lift. Default 1.5 (50% over-represented). */
  minLift?: number;
  /** Max rows to return. Default 12. */
  limit?: number;
}

/** Sum of a Top-N result's requests (its window total for share math). */
function totalRequests(rows: readonly TopNRow[]): number {
  let n = 0;
  for (const r of rows) n += r.requests;
  return n;
}

/**
 * Compute per-value lift of the incident window vs the baseline window for one
 * dimension. Rows are matched by `key`. Returns suspects (over-represented
 * values) sorted by lift, then by incident share, filtered by the options.
 *
 * Shares are computed against each window's own total so windows of different
 * length compare fairly. A small `smoothing` term keeps a value that is 100% of
 * a tiny baseline from producing a misleading near-infinite lift, while genuine
 * newcomers (absent at baseline) are marked `isNew` with lift = Infinity.
 */
export function computeLift(
  incident: readonly TopNRow[],
  baseline: readonly TopNRow[],
  opts: LiftOptions = {},
): LiftRow[] {
  const { minIncidentShare = 0.01, smoothing = 0.001, minLift = 1.5, limit = 12 } = opts;

  const incidentTotal = totalRequests(incident);
  const baselineTotal = totalRequests(baseline);
  if (incidentTotal === 0) return [];

  const baseByKey = new Map<string, TopNRow>();
  for (const r of baseline) baseByKey.set(r.key, r);

  const out: LiftRow[] = [];
  for (const inc of incident) {
    const incidentShare = inc.requests / incidentTotal;
    if (incidentShare < minIncidentShare) continue;

    const base = baseByKey.get(inc.key);
    const baselineRequests = base?.requests ?? 0;
    const baselineShare = baselineTotal ? baselineRequests / baselineTotal : 0;
    const isNew = baselineRequests === 0;

    // Smoothed ratio for ranking; report Infinity for genuine newcomers so the
    // UI can label them, but rank them by their (large) smoothed lift.
    const smoothedLift = (incidentShare + smoothing) / (baselineShare + smoothing);
    const lift = isNew ? Infinity : incidentShare / baselineShare;

    if (smoothedLift < minLift) continue;

    out.push({
      key: inc.key,
      label: inc.label,
      incidentRequests: inc.requests,
      baselineRequests,
      incidentShare,
      baselineShare,
      lift,
      sharePointDelta: (incidentShare - baselineShare) * 100,
      isNew,
    });
  }

  out.sort((a, b) => {
    // New values first (biggest signal), then by smoothed-equivalent ordering:
    // higher incident share breaks ties so a 60%-of-traffic suspect outranks a
    // 2%-but-technically-infinite-lift one.
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (b.lift !== a.lift && Number.isFinite(a.lift) && Number.isFinite(b.lift)) {
      return b.lift - a.lift;
    }
    return b.incidentShare - a.incidentShare;
  });

  return out.slice(0, limit);
}

/**
 * Derive a baseline window that ends where the incident window begins, so the
 * comparison is "what did traffic look like just before this incident". The
 * baseline spans `multiple` x the incident duration (default 4x, capped) for a
 * stable reference, clamped so it never starts before `earliest` (the loaded
 * data's left edge) when provided. Returns ISO bounds, or null if inputs are
 * unparseable or the incident has no positive duration.
 */
export function baselineWindowFor(
  incidentFrom: string,
  incidentTo: string,
  opts: { multiple?: number; maxMs?: number; earliest?: string } = {},
): { from: string; to: string } | null {
  const { multiple = 4, maxMs = 14 * 24 * 3_600_000, earliest } = opts;
  const from = Date.parse(incidentFrom);
  const to = Date.parse(incidentTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  const duration = to - from;
  const span = Math.min(duration * multiple, maxMs);
  let baseStart = from - span;
  const baseEnd = from; // baseline ends exactly where the incident begins

  if (earliest) {
    const e = Date.parse(earliest);
    if (Number.isFinite(e)) baseStart = Math.max(baseStart, e);
  }
  if (baseEnd <= baseStart) return null;

  return { from: new Date(baseStart).toISOString(), to: new Date(baseEnd).toISOString() };
}

