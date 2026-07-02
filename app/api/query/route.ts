import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { authEnabled } from "@/lib/auth/enabled";
import { getDataSource, resolveSourceKind } from "@/lib/datasource";
import { filterSchema } from "@/lib/filters/model";
import type { Dimension } from "@/lib/domain/types";

/**
 * Single BFF dispatcher. The browser never talks to a data source directly,
 * it POSTs { resource, filter, options } here, where credentials (later: Azure /
 * ClickHouse) stay server-side. Route handlers are dynamic by default in Next 16.
 */

const bodySchema = z.object({
  resource: z.string(),
  filter: z.unknown().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  /** Which data source to serve from (UI toggle). Resolved + allowlisted server-side. */
  source: z.string().optional(),
});

const DIMENSIONS = new Set<Dimension>([
  "country", "city", "asnOrg", "clientIp", "host", "path", "status", "statusClass",
  "method", "uaFamily", "deviceType", "pop", "cacheStatus", "referer", "ja4", "errorInfo",
]);

/** Default to "country" when omitted; return undefined for an invalid value. */
function dim(v: unknown): Dimension | undefined {
  if (v === undefined || v === null) return "country";
  return typeof v === "string" && DIMENSIONS.has(v as Dimension) ? (v as Dimension) : undefined;
}

export async function POST(req: NextRequest) {
  if (authEnabled()) {
    const session = await auth();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return badRequest(`Invalid request body: ${(e as Error).message}`);
  }

  const filter = filterSchema.safeParse(parsed.filter ?? {});
  if (!filter.success) return badRequest(`Invalid filter: ${filter.error.message}`);

  const ds = getDataSource(resolveSourceKind(parsed.source));
  const f = filter.data;
  const o = (parsed.options ?? {}) as Record<string, unknown>;
  const json = (data: unknown) => Response.json({ data, source: ds.name });

  try {
    switch (parsed.resource) {
      case "summary":
        return json(await ds.summary(f));
      case "timeseries":
        return json(await ds.timeseries(f, { bucketSeconds: num(o.bucketSeconds) }));
      case "topN": {
        const dimension = dim(o.dimension);
        if (!dimension) return badRequest(`Invalid dimension: ${String(o.dimension)}`);
        return json(
          await ds.topN(f, {
            dimension,
            limit: num(o.limit),
            sortBy: o.sortBy as never,
            sortDir: o.sortDir as never,
          }),
        );
      }
      case "geo":
        return json(await ds.geo(f));
      case "paths":
        return json(
          await ds.paths(f, {
            limit: num(o.limit),
            offset: num(o.offset),
            depth: num(o.depth),
            sortBy: o.sortBy as never,
            sortDir: o.sortDir as never,
          }),
        );
      case "pathVisitors":
        return json(
          await ds.pathVisitors(f, String(o.host ?? ""), String(o.path ?? ""), {
            limit: num(o.limit),
            offset: num(o.offset),
            sortBy: o.sortBy as never,
            sortDir: o.sortDir as never,
          }),
        );
      case "visitors":
        return json(
          await ds.visitors(f, {
            limit: num(o.limit),
            offset: num(o.offset),
            sortBy: o.sortBy as never,
            sortDir: o.sortDir as never,
          }),
        );
      case "visitorDetail":
        return json(await ds.visitorDetail(f, String(o.clientIp ?? "")));
      case "logs":
        return json(
          await ds.logs(f, {
            limit: num(o.limit),
            cursor: (o.cursor as string) ?? null,
            sortDir: o.sortDir as never,
          }),
        );
      case "facetValues": {
        const dimension = dim(o.dimension);
        if (!dimension) return badRequest(`Invalid dimension: ${String(o.dimension)}`);
        return json(await ds.facetValues(f, dimension, num(o.limit)));
      }
      case "proxyChains":
        return json(await ds.proxyChains(f, num(o.limit)));
      default:
        return badRequest(`Unknown resource: ${parsed.resource}`);
    }
  } catch (e) {
    console.error("[/api/query] handler error:", e);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
