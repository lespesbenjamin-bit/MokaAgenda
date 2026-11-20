import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PublicBookingView } from "@/components/booking/public-booking-view";
import { getSiteUrl, isDemo } from "@/lib/env";
import { bookingPath, isValidSlug } from "@/lib/domain/slug";
import { loadPublicPage } from "@/server/services/public-booking";

/** Page publique de réservation d'une professionnelle (sans compte). */

export async function generateMetadata({ params }: PageProps<"/reserver/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = isValidSlug(slug) ? await loadPublicPage(slug) : null;
  if (!page) return { title: "Réservation", robots: { index: false } };
  const description = page.business.description?.slice(0, 160) ?? `Réservez en ligne avec ${page.business.name}.`;
  return {
    title: `Réserver — ${page.business.name}`,
    description,
    alternates: { canonical: `${getSiteUrl()}${bookingPath(page.business.slug)}` },
    openGraph: { title: page.business.name, description, images: page.coverUrl ? [page.coverUrl] : page.logoUrl ? [page.logoUrl] : [] },
    robots: isDemo ? { index: false } : undefined,
  };
}

export default async function PublicBookingPage({ params }: PageProps<"/reserver/[slug]">) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const page = await loadPublicPage(slug);
  if (!page) notFound();

  return <PublicBookingView page={page} now={new Date()} idempotencyKey={randomUUID()} />;
}
