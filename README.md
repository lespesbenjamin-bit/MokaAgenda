# Moka Réservation

Plateforme SaaS de réservation et de gestion pour les professionnelles de la beauté — à domicile, en institut ou les deux. Éditée par Moka Studio.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · composants style shadcn/ui · Supabase (Auth, PostgreSQL, Storage, RLS) · Vercel.

## Commandes

| Commande | Rôle |
|---|---|
| `npm install` | Installer les dépendances |
| `npm run dev` | Lancer en local sur http://localhost:3000 |
| `npm run check` | Typage + lint + tests unitaires + build |
| `npm run test:db` | Tests SQL et sécurité RLS (PostgreSQL local) |
| `npm run test:e2e:all` | Build et tests HTTP (production, sans configuration, démo) |

## Mise en service

Toute la configuration Supabase, Vercel et démo est décrite pas à pas dans [`docs/SETUP.md`](./docs/SETUP.md).
Les variables d'environnement sont documentées dans [`.env.example`](./.env.example).

## Documentation

- [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — état du projet, à fournir pour reprendre le travail
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/DATABASE_SCHEMA.md`](./docs/DATABASE_SCHEMA.md) · [`docs/TEST_REPORT.md`](./docs/TEST_REPORT.md) · [`docs/ROADMAP.md`](./docs/ROADMAP.md)
