# PROJECT_CONTEXT — Moka Réservation

> Fichier de reprise : à fournir en début de toute nouvelle conversation Claude.
> Dernière mise à jour : 20 novembre 2026 — Sprint 1 validé en production (parcours inscription → onboarding → tableau de bord testé). Sprint 2 : migration exécutée dans Supabase, PR #2 fusionnée et déployée ; recette manuelle en cours. Sprint 3 **non commencé**.

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

## Design « Blanc vif » (choisi le 19/11, prime sur les mentions crème/terracotta des cahiers des charges)
Blanc `#FFFFFF`, surface `#FAFAFA`, orange vif `#FF6B2C` (accents), orange fort `#CC4A0C` (boutons, contraste AA), encre `#18181B`. Police Plus Jakarta Sans. Logo « moka. ». Détails : `docs/ARCHITECTURE.md`.

## État d'avancement

| Élément | État |
|---|---|
| Socle, design, navigation responsive, pages « À venir » | ✅ en production |
| Schéma SQL + RLS + Storage | ✅ testé (PostgreSQL local) et exécuté sur Supabase |
| Authentification complète | ✅ développée, testée hors Supabase réel — **recette manuelle à faire** |
| Onboarding 5 étapes persistant + logo | ✅ développé, testé au niveau base — **recette manuelle à faire** |
| Tableau de bord connecté | ✅ développé — **recette manuelle à faire** |
| Environnement démo | ✅ développé, garde-fous testés — **projet Supabase/Vercel démo à créer** |
| **Prestations** (catégories, formulaire complet, liste, duplication, archivage, marge indicative) | ✅ Sprint 2 — testé (unitaires, PostgreSQL, visuel) — **recette à faire** |
| **Clientes** (fiche à onglets, adresses, préférences, consentements, doublons, import CSV) | ✅ Sprint 2 — idem |
| Démo v2 (6 catégories, 20 prestations, 25 clientes) | ✅ données testées en base — projet démo à créer |
| **Agenda** (jour/semaine/mois, création, modification, glisser-déposer, statuts, historique) | ✅ Sprint 3 — testé (unitaires, PostgreSQL, visuel) — **recette à faire** |
| **Disponibilités** (plages par jour et par lieu, pauses, congés, fermetures, indisponibilités) | ✅ Sprint 3 — conflits garantis par PostgreSQL |
| Tableau de bord : indicateurs réels de rendez-vous | ✅ Sprint 3 |
| Moteur de disponibilités réutilisable (`src/lib/domain/availability.ts`, `freeSlots`) | ✅ prêt pour le Sprint 4 |
| Écran Paramètres (modification) | « À venir » (reporté) |
| Réservation en ligne, Stripe, tournées et trajets, finances, boutique | non commencés |

Branche `sprint-1-5-fiabilisation` fusionnée dans `main` (PR #1) et déployée sur https://moka-agenda.vercel.app.

### Configuration réalisée (19/11)
- Projet Supabase de production : **MokaAgenda** — migrations 1 et 2 exécutées.
- Auth : *Confirm email* activé ; Site URL et Redirect URLs (`/auth/confirm`, `https://moka-agenda.vercel.app/**`, localhost) configurées.
- Vercel (projet `moka-agenda`, équipe `coaching6`) : variables Supabase + `NEXT_PUBLIC_SITE_URL` ajoutées ; site vérifié en ligne (connexion sans alerte de configuration, pages privées redirigées).

### Reste à faire
- [x] Inscription testée en production (19/11)
- [x] Parcours Sprint 1 complet validé en production (20/11)
- [x] Sprint 2 : migration exécutée, PR #2 fusionnée et déployée (20/11)
- [ ] Sprint 2 : recette `docs/SETUP.md` §4 « Sprint 2 »
- [ ] Sprint 3 : exécuter `supabase/migrations/20261121000001_sprint3_agenda.sql`, fusionner la PR, recette §4 « Sprint 3 »
- [ ] Modèles d'emails personnalisés (reportés volontairement ; en attendant, ouvrir le lien de confirmation dans le même navigateur)
- [ ] SMTP personnalisé avant ouverture aux clientes
- [ ] Projets Supabase + Vercel de démonstration

## Où trouver quoi

- `docs/SETUP.md` — configuration Supabase / Vercel / démo + recette manuelle (Sprint 1 et 2)
- `src/lib/domain/` — règles métier pures (tarifs, acomptes, marges, doublons, import CSV, disponibilités, fuseaux, statuts)
- `docs/ARCHITECTURE.md` — couches, flux d'authentification, design system
- `docs/DATABASE_SCHEMA.md` — tables, politiques RLS, tables futures
- `docs/TEST_REPORT.md` — tests exécutés et résultats
- `docs/ROADMAP.md` — suite du projet
- `supabase/migrations/` — SQL (à exécuter dans l'ordre)
- `supabase/demo/fixtures.json` — données fictives de la démo

## Hypothèses techniques

- Un seul agenda par entreprise (V1). Les horaires et conflits sont garantis par PostgreSQL (déclencheurs + contrainte d'exclusion, extension `btree_gist`).
- Agenda : FullCalendar 6.1 (+ Luxon pour le fuseau de l'entreprise). Ne pas passer à FullCalendar 7 sans revue (API différente).

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
# Aperçu local des écrans sans base (jamais en production) :
# MOKA_UI_PREVIEW=1 npm run dev  →  http://localhost:3000/apercu-dev/prestations
```
