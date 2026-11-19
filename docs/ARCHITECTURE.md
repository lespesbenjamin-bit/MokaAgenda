# Architecture — Moka Réservation

## Principes

- **Une base de code, deux déploiements isolés** : production et démo ont chacun leur projet Vercel et leur projet Supabase. La démo ne partage aucune donnée ni clé avec la production et n'utilise que des clés Stripe de test.
- **Sécurité côté serveur** : RLS PostgreSQL sur toutes les tables métier, permissions revérifiées dans les Server Actions, clé `service_role` uniquement dans des fichiers `server-only`.
- **Honnêteté de l'interface** : un module non développé affiche un état « À venir » et ne simule aucune donnée. Aucune donnée fictive en production.

## Couches

| Dossier | Rôle |
|---|---|
| `src/components/` | UI pure, sans accès aux données |
| `src/server/services/` | Règles métier (onboarding, permissions…) |
| `src/server/repositories/` | Seul endroit qui interroge Supabase |
| `src/server/integrations/` | Supabase admin, Stripe (plus tard) |
| `supabase/migrations/` | Schéma SQL versionné |

## Choix techniques

- **Next.js 16 sans Cache Components** : l'application est authentifiée et presque chaque écran dépend de la session ; le rendu dynamique classique est plus simple et évite de mettre en cache des données d'une entreprise par erreur.
- **Polices auto-hébergées** (`@fontsource-variable`) : Manrope (interface) et Fraunces (titres). Aucun appel à Google Fonts.
- **Composants style shadcn/ui** écrits dans `src/components/ui/` (`components.json` présent pour ajouter d'autres composants avec la CLI shadcn).

## Design system

| Token | Valeur | Usage |
|---|---|---|
| Blanc cassé | `#FAF7F2` | Fond |
| Crème | `#F1E8DA` | Surfaces secondaires |
| Terracotta | `#B4532F` | Actions (contraste AA sur blanc) |
| Anthracite | `#2B2A28` | Texte |
| Pierre | `#6F6A63` | Texte secondaire |
| Rayon | 16 px (cartes), pilule (boutons) | |

## Feuille de route du Sprint 1

1. ✅ Socle Next.js, design system, layout responsive, pages « À venir »
2. Migrations SQL, RLS, Storage, tests d'isolation entre entreprises
3. Authentification Supabase + protection des routes
4. Onboarding en 5 étapes avec reprise
5. Dashboard connecté + Paramètres
6. Environnement de démonstration
7. Documentation finale et critères de validation
