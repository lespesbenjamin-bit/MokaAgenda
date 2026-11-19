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
- **Polices auto-hébergées** (`@fontsource-variable`) : Plus Jakarta Sans (interface et titres). Aucun appel à Google Fonts.
- **Composants style shadcn/ui** écrits dans `src/components/ui/` (`components.json` présent pour ajouter d'autres composants avec la CLI shadcn).

## Design system — direction « Blanc vif »

| Token | Valeur | Usage |
|---|---|---|
| Blanc | `#FFFFFF` | Fond principal |
| Surface | `#FAFAFA` | Fonds secondaires |
| Orange vif | `#FF6B2C` | Accent : logo, éléments actifs, touches de couleur |
| Orange fort | `#CC4A0C` | Boutons et texte orange (contraste AA sur blanc) |
| Orange doux | `#FFF1E8` | Fonds de badges et d'éléments actifs |
| Encre | `#18181B` | Texte |
| Gris | `#71717A` | Texte secondaire |
| Police | Plus Jakarta Sans | Titres en gras, tracking serré |
| Rayon | 16 px (cartes), pilule (boutons) | |

L'orange vif n'est jamais utilisé comme fond d'un texte blanc de petite taille (contraste insuffisant) : les boutons utilisent l'orange fort.

## Feuille de route du Sprint 1

1. ✅ Socle Next.js, design system, layout responsive, pages « À venir »
2. Migrations SQL, RLS, Storage, tests d'isolation entre entreprises
3. Authentification Supabase + protection des routes
4. Onboarding en 5 étapes avec reprise
5. Dashboard connecté + Paramètres
6. Environnement de démonstration
7. Documentation finale et critères de validation
