import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isDemo } from "@/lib/env";
import { resetDemo } from "@/server/demo/reset";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Réinitialisation de la démo. Appelée par la tâche planifiée Vercel (chaque nuit)
 * ou manuellement avec : Authorization: Bearer <CRON_SECRET>.
 * Inexistante (404) en dehors de l'environnement démo.
 */
async function handle(request: NextRequest) {
  if (!isDemo) return new NextResponse(null, { status: 404 });
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const result = await resetDemo();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[demo] réinitialisation", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
