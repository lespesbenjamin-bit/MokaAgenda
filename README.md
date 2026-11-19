# Moka Réservation

Plateforme SaaS de réservation et de gestion pour les professionnelles de la beauté — à domicile, en institut ou les deux. Éditée par Moka Studio.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · composants style shadcn/ui · Supabase (Auth, PostgreSQL, Storage, RLS) · Vercel.

## Commandes

| Commande | Rôle |
|---|---|
| `npm install` | Installer les dépendances |
| `npm run dev` | Lancer en local sur http://localhost:3000 |
| `npm run typecheck` | Vérifier le typage TypeScript |
| `npm run lint` | Vérifier la qualité du code |
| `npm test` | Lancer les tests |
| `npm run build` | Compiler pour la production |
| `npm run check` | Tout vérifier d'un coup (typage + lint + tests + build) |

## Environnements

| | Production | Démo |
|---|---|---|
| Projet Vercel | `moka-reservation` | `moka-reservation-demo` (étape 6) |
| Projet Supabase | `moka-prod` | `moka-demo` (base distincte) |
| `NEXT_PUBLIC_APP_ENV` | `production` | `demo` |

Les variables sont documentées dans [`.env.example`](./.env.example).

## Déploiement Vercel (première fois)

1. Aller sur https://vercel.com/new et choisir **Import Git Repository** → `MokaAgenda`.
2. Framework : **Next.js** (détecté automatiquement). Ne rien changer aux commandes de build.
3. Ouvrir **Environment Variables** et ajouter :
   - `NEXT_PUBLIC_APP_ENV` = `production`
4. Cliquer sur **Deploy**.

Ensuite, chaque `git push` sur `main` redéploie automatiquement.

## Organisation du code

```
src/
├── app/                 Routes (App Router)
│   ├── (app)/           Espace professionnel (sidebar + navigation mobile)
│   └── page.tsx         Page d'accueil publique
├── components/
│   ├── ui/              Composants de base (Button, Card, Badge…)
│   ├── layout/          Sidebar, navigation mobile, bandeau démo
│   └── modules/         Composants propres aux modules
├── config/              Navigation et statut des modules
├── lib/                 Utilitaires, environnement
└── server/              (à venir) services métier, accès aux données, intégrations
docs/                    Architecture et décisions
tests/                   Tests unitaires (Vitest)
```

Voir [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) pour le détail.
