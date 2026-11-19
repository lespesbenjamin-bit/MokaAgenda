import type { Metadata, Viewport } from "next";
import { DemoBanner } from "@/components/layout/demo-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Moka Réservation",
    template: "%s · Moka Réservation",
  },
  description:
    "La plateforme de réservation et de gestion pour les professionnelles de la beauté, à domicile et en institut.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
