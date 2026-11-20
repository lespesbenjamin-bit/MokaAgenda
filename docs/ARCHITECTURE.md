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
| Réservation en ligne (Sprint 4, public) | `/reserver/[slug]`, `/reservation/[token]` | `server/actions/public-booking.ts` | `server/services/public-booking.ts` (client **anonyme** `integrations/supabase/public.ts`, fonctions `public_*` uniquement) |
| Paramètres → réservation (Sprint 4) | `/parametres` | `server/actions/booking-settings.ts` | `server/repositories/business.ts` |
| Services réservation | — | — | `server/services/booking-catalog.ts` (prestations réservables, devis figé, recherche de cliente, adresse d'intervention) |

**Calculs** : tous les montants sont en centimes, saisis TTC. La marge indicative = prix HT − consommables − autres coûts directs, **avant déplacement, cotisations et charges fixes** ; elle n'est jamais présentée comme un bénéfice.

**Import CSV** : lecture et correspondance des colonnes dans le navigateur ; vérification, détection des doublons et création **refaites côté serveur**. Aucune fiche existante n'est modifiée ; chaque ligne porte une clé d'import unique (relancer le même fichier ne crée pas de doublon).

**Aperçu local** : `/apercu-dev/[ecran]` affiche les écrans avec les données démo, sans base. Actif seulement hors production et avec `MOKA_UI_PREVIEW=1` (404 sinon, testé).

## Moteur de disponibilités (Sprint 3)

Une seule logique, deux exécutions :
- **PostgreSQL** (garantie finale) : déclencheur `appointment_check_availability` + contrainte d'exclusion + verrou transactionnel par entreprise.
- **`src/lib/domain/availability.ts`** (mêmes règles, testées sur les mêmes scénarios) : messages clairs, créneaux proposés quand un horaire est refusé, et `freeSlots()`, réutilisé tel quel par la réservation en ligne (Sprint 4).

Fuseaux : `src/lib/domain/time.ts` (API Intl, sans dépendance) ; l'agenda (FullCalendar 6 + plugin Luxon) s'affiche dans le fuseau de l'entreprise, quel que soit celui de l'appareil.

**Agenda** : FullCalendar 6.1 (`@fullcalendar/*`, maintenu, compatible React 19). Vues jour / semaine / mois ; sur mobile, la semaine s'affiche en liste. Glisser-déposer et redimensionnement sur ordinateur ; sur mobile et au clavier, déplacement par le formulaire « Modifier ou déplacer ».

## Réservation en ligne (Sprint 4)

```
Navigateur (cliente, sans compte)
  └─ Server Actions publiques ── limitation de débit par IP (mémoire, meilleur effort)
       │                         validation Zod + piège anti-robots + délai minimal
       └─ client Supabase ANONYME (clé publique, sans session)
            └─ fonctions public_* (security definer, périmètre étroit) ── aucune table accessible
                 ├─ public_booking_page     : infos publiques + prestations réservables
                 ├─ public_availability     : plages, blocages (sans motif), temps occupés (sans détail)
                 ├─ public_create_booking   : revalidation complète, prix relus, verrou, fiche cliente, emails en file
                 ├─ public_get_booking / public_cancel_booking / public_reschedule_booking (lien secret)
                 └─ public_record_notification : résultat d'envoi
```

- **Créneaux** : `publicSlots()` (`lib/domain/public-booking.ts`) appelle `freeSlots()`, le moteur de l'agenda, sur les données de `public_availability`. Le navigateur ne reçoit que des heures libres ; il n'est jamais une preuve de disponibilité : la base refait tout (déclencheurs Sprint 3 + contrainte d'exclusion + verrou).
- **Lien de gestion** : jeton aléatoire de 32 octets (`server/security/tokens.ts`) ; la base ne stocke que son empreinte SHA-256. Pages `/reservation/*` : `Referrer-Policy: no-referrer`, `noindex`, `no-store`.
- **Doubles soumissions** : clé d'idempotence générée à l'affichage du formulaire, unique par entreprise.
- **Emails** : `server/notifications/templates.ts` (gabarits purs, valeurs échappées) + `mailer.ts` (Resend / simulé en démo / désactivé). La base crée les lignes `notifications` ; le serveur envoie puis enregistre le résultat. Une panne d'email n'annule jamais la réservation. Rappels : colonne `scheduled_for` prévue.
- **Actions de la professionnelle** : annuler ou déplacer un rendez-vous **pris en ligne** prévient la cliente (`server/services/pro-notifications.ts`, via la RLS).
- **Agenda** : actualisation automatique toutes les 60 s et au retour sur l'onglet.

## Déplacements (Sprint 5)

```
Fournisseur (IGN Géoplateforme)  ←  src/server/travel/ign.ts (adaptateur TravelProvider)
        ↑ limiteur 4 req/s, cache mémoire, 1 nouvel essai sur 429/5xx
src/server/travel/service.ts : géocodage validé (ok / ambigu / introuvable / indisponible),
        trajets, SIGNATURE HMAC (signing.ts) → public.record_travel_estimate (base)
        ↓
PostgreSQL : travel_estimates (seuls les trajets signés), déclencheur appointments_35_travel
        (précédent ET suivant, marge), frais et zones recalculés dans public_create_booking
```

- **Aucune valeur inventée** : un trajet inconnu bloque la réservation publique (MOKA_TRAVEL_UNKNOWN) ; la professionnelle peut enregistrer « sans vérifier le trajet » (statut `skipped_by_pro`, réservé aux membres).
- **Clé de signature** : générée dans la base (`private.app_secrets`, inaccessible aux rôles anon/authenticated), copiée dans Vercel (`TRAVEL_SIGNING_SECRET`). Trois messages signés : trajet, adresse vérifiée (jeton valable 2 h, lié à l'entreprise) et lecture serveur des arrêts privés (preuve valable 5 min).
- **Règles métier pures** (`lib/domain/travel.ts`) identiques aux fonctions SQL : coût (énergie, usure ou coût global, temps, autres ; arrondi au centime par poste), frais (5 modes, inclus, minimum, maximum, supplément), zones, marge, voisins, rentabilité, optimisation (recherche exhaustive ≤ 7 arrêts).
- **Réservation publique** (`services/public-travel.ts`) : adresse → zone → frais → créneaux filtrés par `checkTravel` ; avant confirmation, les trajets du créneau sont recalculés et enregistrés ; la base revérifie tout.
- **Agenda pro** (`services/pro-travel.ts`) : adresse cliente localisée et mémorisée, pré-contrôle des trajets, ligne « Frais de déplacement » (type `travel_fee`), instantané `appointment_travel` (coûts, version des réglages, véhicule).
- **Tournées** (`services/tours.ts`) : trajets depuis le cache puis le fournisseur ; proposition enregistrée (`route_plans`), appliquée par `apply_route_plan` (tout ou rien, contrainte anti-chevauchement différée, trajets revérifiés).
- **Carte** : Leaflet + fond « Plan IGN » (WMTS Géoplateforme), chargé côté navigateur uniquement.

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
