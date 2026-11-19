# PROJECT_CONTEXT — Moka Réservation

> Fichier de reprise : à fournir en début de toute nouvelle conversation Claude.
> Dernière mise à jour : 19 novembre 2026 — fin du Sprint 1 (fiabilisation), Sprint 2 **non commencé**.

## Le produit

Moka Réservation (dépôt `lespesbenjamin-bit/MokaAgenda`) est un SaaS multi-entreprises de réservation et de gestion pour les professionnelles de la beauté : à domicile, en institut ou hybride. Édité par Moka Studio (Benjamin LESPES). Interface et documentation en français.

### Décisions produit définitives
- Positionnement hybride (domicile / institut / mixte).
- Acompte optionnel, configurable par prestation (aucun, montant fixe, pourcentage) ; confirmation après paiement si acompte exigé ; suivi du solde.
- Confirmation automatique des réservations, disponibilités vérifiées côté serveur, anti-conflit, temps de trajet pris en compte plus tard.
- Environnement démo obligatoire : base Supabase distincte, données fictives signalées, réinitialisable, paiements en mode test uniquement.
- Abonnements prévus : plans Solo et Complet (Stripe, sprint ultérieur).

## Stack

Next.js 16.4 (App Router, **Proxy** au lieu de Middleware, sans Cache Components) · React 19 · TypeScript strict · Tailwind CSS 4 · composants style shadcn/ui · Zod 4 · Supabase (Auth, PostgreSQL, Storage, RLS) via `@supabase/ssr` · Vercel · Vitest.

⚠️ Next.js 16 diffère des versions connues : lire `node_modules/next/dist/docs/` avant de coder (voir `AGENTS.md`).

## Design « Blanc vif »
Blanc `#FFFFFF`, surface `#FAFAFA`, orange vif `#FF6B2C` (accents), orange fort `#CC4A0C` (boutons, contraste AA), encre `#18181B`. Police Plus Jakarta Sans. Logo « moka. ». Détails : `docs/ARCHITECTURE.md`.

## État d'avancement

| Élément | État |
|---|---|
| Socle, design, navigation responsive, pages « À venir » | ✅ en production (branche `main`) |
| Schéma SQL + RLS + Storage | ✅ développé et testé (PostgreSQL local) — **à exécuter sur Supabase** |
| Authentification complète | ✅ développée, testée hors Supabase réel — **recette manuelle à faire** |
| Onboarding 5 étapes persistant + logo | ✅ développé, testé au niveau base — **recette manuelle à faire** |
| Tableau de bord connecté | ✅ développé — **recette manuelle à faire** |
| Environnement démo | ✅ développé, garde-fous testés — **projet Supabase/Vercel démo à créer** |
| Écran Paramètres (modification) | « À venir » (Sprint 2) |
| Prestations, clientes, agenda, réservation, Stripe, tournées, finances, boutique | non commencés |

Branche de travail : `sprint-1-5-fiabilisation` (pull request vers `main`).

## Où trouver quoi

- `docs/SETUP.md` — configuration Supabase / Vercel / démo + recette manuelle
- `docs/ARCHITECTURE.md` — couches, flux d'authentification, design system
- `docs/DATABASE_SCHEMA.md` — tables, politiques RLS, tables futures
- `docs/TEST_REPORT.md` — tests exécutés et résultats
- `docs/ROADMAP.md` — suite du projet
- `supabase/migrations/` — SQL (à exécuter dans l'ordre)
- `supabase/demo/fixtures.json` — données fictives de la démo

## Règles de travail convenues

- Travailler par étapes, vérifier typage + lint + tests + build après chaque étape, ne jamais déclarer fonctionnel ce qui n'a pas été vérifié.
- Ne pas passer au sprint suivant sans accord explicite.
- Ne jamais supprimer ou écraser de données existantes ; ne pas modifier les secrets.
- Aucune clé service_role pour les actions utilisatrices (uniquement réinitialisation démo).
- Aucune donnée fictive en production ; modules non développés = « À venir ».
- Quand du SQL est à exécuter dans Supabase, le coller en entier dans la réponse.
- L'utilisateur n'est pas développeur : instructions pas à pas pour Supabase, GitHub et Vercel.

## Commandes

```bash
npm run dev            # développement local
npm run check          # typage + lint + tests unitaires + build
npm run test:db        # tests SQL/RLS (PostgreSQL local requis)
npm run test:e2e:all   # build + tests HTTP en production, sans config, et démo
```
