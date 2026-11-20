import { NextResponse, type NextRequest } from "next/server";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/server/services/finance";

export const dynamic = "force-dynamic";

/** Export CSV : propriétaire uniquement (contrôle applicatif + RLS). Jamais mis en cache. */
export async function GET(request: NextRequest) {
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const kind = sp.type as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) return NextResponse.json({ error: "Type d'export inconnu" }, { status: 400 });
  const { filename, csv } = await buildExport(kind, sp);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
