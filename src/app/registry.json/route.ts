import { emit } from "@/lib/protocol/events";
import { originFromRequest } from "@/lib/protocol/llms-txt";
import { loadRegistryIndexPage } from "@/lib/protocol/registry-index-load";
import { renderRegistryJsonFromIndex } from "@/lib/protocol/registry";
import { verifierInfo, verifySellers } from "@/lib/xrpl/seller-credential";

export const runtime = "nodejs";

/**
 * Fashion network registry (paginated).
 * GET /registry.json?limit=50&cursor=<slug>&verified=1
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : 50;
  const cursor = url.searchParams.get("cursor");

  const verifiedOnly = url.searchParams.get("verified") === "1";

  const page = await loadRegistryIndexPage({ limit, cursor });
  const origin = originFromRequest(request);
  const verification = await verifySellers(
    page.entries.map((e) => e.merchantAddress),
  );
  const body = renderRegistryJsonFromIndex(page.entries, origin, {
    nextCursor: page.nextCursor,
    limit,
    totalHint: page.totalHint,
    verification,
    verifier: verifierInfo(),
    verifiedOnly,
  });

  emit({
    status: 200,
    method: "GET",
    path: "/registry.json",
    message: `registry index · ${page.entries.length} store(s)${page.nextCursor ? " · hasMore" : ""}`,
  });

  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=15, stale-while-revalidate=60",
    },
  });
}
