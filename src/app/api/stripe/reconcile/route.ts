import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { reconcileAll } from "@/server/payments/service";
import { readStripeConfig } from "@/server/payments/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Réconciliation quotidienne (tâche planifiée Vercel) : rattrape un webhook perdu et relance les remboursements en attente. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!readStripeConfig()) return NextResponse.json({ ok: true, skipped: "Stripe non configuré" });
  try {
    return NextResponse.json({ ok: true, ...(await reconcileAll()) });
  } catch (e) {
    console.error("[stripe] réconciliation", e instanceof Error ? e.message.slice(0, 120) : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
