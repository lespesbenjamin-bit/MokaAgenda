# Architecture — Moka Réservation

## Principes

- **Une base de code, deux déploiements isolés** : production et démo ont chacun leur projet Vercel et leur projet Supabase. La démo n'a ni les données ni les clés de la production.
- **Sécurité en profondeur** : (1) proxy qui redirige les visiteuses, (2) vérification serveur `requireUser()` dans chaque page et action privée, (3) RLS PostgreSQL qui fait foi en dernier ressort.
- **Aucune clé service_role pour les actions utilisatrices** : toutes passent par le client Supabase de l'utilisatrice. La clé service_role n'est utilisée que par la réinitialisation démo, dans un fichier `server-only`.
- **Honnêteté de l'interface** : modules non développés = « À venir » ; aucune donnée fictive hors démo.

## Couches

| Dossier | Rôle |
|---|---|
| `src/app/` | routes (App Router) : `(auth)`, `(app)`, `onboarding`, `auth/confirm`, `api/demo/reset` |
| `src/proxy.ts` | rafraîchit la session, redirige (Next.js 16 : « Proxy » remplace « Middleware ») |
| `src/components/` | UI pure (`ui/`, `layout/`, `auth/`, `onboarding/`, `modules/`) |
| `src/server/actions/` | Server Actions (validation Zod côté serveur) |
| `src/server/services/` | contexte métier (`requireBusinessContext`) |
| `src/server/repositories/` | seul endroit qui interroge les tables |
| `src/server/integrations/supabase/` | clients serveur, proxy, admin |
| `src/server/demo/` | fixtures, garde-fous, réinitialisation |
| `src/lib/` | env, routes, validation partagée |
| `src/lib/domain/` | **règles métier pures et testées** : tarifs, acomptes, marges, doublons clientes, import CSV |
| `supabase/migrations/` | schéma SQL versionné |
| `supabase/demo/fixtures.json` | données fictives versionnées |

## Flux d'authentification

1. Inscription (`signUpAction`) → Supabase envoie l'email → lien vers `/auth/confirm` (token_hash ou code PKCE) → session créée → `/onboarding`.
2. Connexion → `?next=` validé par `safeNextPath` (anti redirection ouverte).
3. Proxy : `getClaims()` (JWT vérifié) ; pages privées → `/connexion?next=…`.
4. Pages privées : `getUser()` (vérifié côté Supabase) puis entreprise ; onboarding incomplet → `/onboarding`.

## Modules du Sprint 2

| Module | Pages | Actions serveur | Données |
|---|---|---|---|
| Prestations | `/prestations`, `/prestations/nouvelle`, `/prestations/[id]`, `/prestations/categories` | `server/actions/catalog.ts` | `server/repositories/catalog.ts` |
| Clientes | `/clientes`, `/clientes/nouvelle`, `/clientes/[id]?onglet=…`, `/clientes/import` | `server/actions/customers.ts`, `customer-import.ts` | `server/repositories/customers.ts` |
| Agenda (Sprint 3) | `/agenda`, `/agenda/nouveau`, `/agenda/[id]`, `/agenda/disponibilites` | `server/actions/agenda.ts` | `server/repositories/agenda.ts`, `server/services/agenda.ts` |
| Services réservation | — | — | `server/services/booking-catalog.ts` (prestations réservables, devis figé, recherche de cliente, adresse d'intervention) |

**Calculs** : tous les montants sont en centimes, saisis TTC. La marge indicative = prix HT − consommables − autres coûts directs, **avant déplacement, cotisations et charges fixes** ; elle n'est jamais présentée comme un bénéfice.

**Import CSV** : lecture et correspondance des colonnes dans le navigateur ; vérification, détection des doublons et création **refaites côté serveur**. Aucune fiche existante n'est modifiée ; chaque ligne porte une clé d'import unique (relancer le même fichier ne crée pas de doublon).

**Aperçu local** : `/apercu-dev/[ecran]` affiche les écrans avec les données démo, sans base. Actif seulement hors production et avec `MOKA_UI_PREVIEW=1` (404 sinon, testé).

## Moteur de disponibilités (Sprint 3)

Une seule logique, deux exécutions :
- **PostgreSQL** (garantie finale) : déclencheur `appointment_check_availability` + contrainte d'exclusion + verrou transactionnel par entreprise.
- **`src/lib/domain/availability.ts`** (mêmes règles, testées sur les mêmes scénarios) : messages clairs, créneaux proposés quand un horaire est refusé, et `freeSlots()` qui servira à la réservation en ligne du Sprint 4.

Fuseaux : `src/lib/domain/time.ts` (API Intl, sans dépendance) ; l'agenda (FullCalendar 6 + plugin Luxon) s'affiche dans le fuseau de l'entreprise, quel que soit celui de l'appareil.

**Agenda** : FullCalendar 6.1 (`@fullcalendar/*`, maintenu, compatible React 19). Vues jour / semaine / mois ; sur mobile, la semaine s'affiche en liste. Glisser-déposer et redimensionnement sur ordinateur ; sur mobile et au clavier, déplacement par le formulaire « Modifier ou déplacer ».

## Choix techniques

- Next.js 16 **sans Cache Components** (application authentifiée, rendu dynamique plus simple et sans risque de cache croisé entre entreprises).
- Police Plus Jakarta Sans auto-hébergée (`@fontsource-variable`).
- Composants style shadcn/ui écrits dans `src/components/ui/`.

## Design system — direction « Blanc vif »

| Token | Valeur | Usage |
|---|---|---|
| Blanc | `#FFFFFF` | Fond |
| Surface | `#FAFAFA` | Fonds secondaires |
| Orange vif | `#FF6B2C` | Accent (logo, actif, progression) |
| Orange fort | `#CC4A0C` | Boutons, liens (contraste AA) |
| Orange doux | `#FFF1E8` | Badges, éléments actifs |
| Encre | `#18181B` | Texte |
| Gris | `#71717A` | Texte secondaire |
