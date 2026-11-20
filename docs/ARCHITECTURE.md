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

## Finances et paiements (Sprint 6)

**Couches.** `src/lib/domain/finance.ts` (calculs purs, testés) ; `src/server/repositories/finance.ts` (lectures RLS, client de l'utilisatrice) ; `src/server/services/finance.ts` (périodes, exports CSV) ; `src/server/payments/` (`stripe.ts` configuration, `signing.ts` opérations signées + chiffrement du lien, `service.ts` Connect, Checkout, webhook, remboursements, réconciliation) ; routes `api/stripe/webhook`, `api/stripe/reconcile` (tâche planifiée), `api/finances/export`.

**Modèle de paiement.** Stripe Connect, *paiement direct* : chaque professionnelle a son compte Stripe (API Accounts v1 avec propriétés de contrôleur : frais payés par le compte, pertes portées par Stripe, tableau de bord complet), les sessions Checkout sont créées **sur son compte** (`Stripe-Account`), carte uniquement. Aucune commission Moka (`application_fee_amount` non utilisé).

**Parcours des arrhes.**
1. `public_create_booking` (base) recalcule prix et arrhes, fait un **essai complet** (cliente, adresse, rendez-vous et tous les déclencheurs) annulé aussitôt, puis crée une réservation temporaire `booking_holds` (35 min) sous le verrou de l'agenda ;
2. le serveur crée la session Checkout (expiration 30 min < 35 min, clé d'idempotence = réservation), dépose le lien de gestion dans un cookie `httpOnly` et redirige ;
3. **seul** l'événement Stripe signé (`checkout.session.completed`) déclenche `server_payment_op('checkout_completed')` : verrou, nouvelle vérification complète du créneau, création du rendez-vous et du paiement dans la même transaction ; email envoyé avec le lien de gestion (chiffré AES-256-GCM pendant le paiement) ;
4. créneau perdu ou montant incohérent → paiement enregistré + remboursement intégral demandé puis exécuté chez Stripe (clé d'idempotence = remboursement), email à la cliente ;
5. abandon : expiration Stripe → réservation libérée ; « Annuler » expire d'abord la session chez Stripe.

**Fiabilité.** Signature Stripe vérifiée sur le corps brut ; journal `payment_events` (identifiant unique → doublons ignorés) ; erreur → HTTP 500 pour que Stripe réessaie (événements dans le désordre : un remboursement d'un paiement inconnu est refusé puis rejoué) ; états horodatés (`last_event_at`) pour ne jamais revenir en arrière ; réconciliation quotidienne et bouton « Actualiser et resynchroniser » (sessions des 48 h, remboursements non exécutés). Le retour du navigateur ne confirme jamais rien.

**Écritures.** Le registre (`payments`, `refunds`, `payment_disputes`, `payouts`, `payment_events`) n'est écrit que par des fonctions de la base : opérations serveur signées (HMAC, clé `TRAVEL_SIGNING_SECRET`) ou fonctions `security definer` réservées à la propriétaire (`record_manual_payment`, `validate_manual_payment`, `request_refund`). Montants, moyens, dates et liens d'un paiement sont immuables ; corrections = `financial_adjustments` (insertion seule).

### Formules financières (montants en centimes)

| Indicateur | Formule |
|---|---|
| CA réalisé | rendez-vous **terminés** de la période : Σ (prix appliqué + supplément) TTC des lignes figées ; HT = TTC / (1 + TVA) par ligne, arrondi au centime ; **franchise : HT = TTC, TVA = 0** ; + arrhes conservées sur annulations/absences (hypothèse HT = TTC, à confirmer avec le comptable) + ajustements de CA |
| CA prévisionnel | rendez-vous confirmés ou en attente, **à venir** ; les passés non clôturés sont affichés à part (« à clôturer ») et comptés nulle part |
| Encaissé | paiements **validés** reçus dans la période − remboursements effectués dans la période ± ajustements d'encaissement ; un règlement « à valider » n'est jamais compté |
| Reste à encaisser | Σ max(0, prix − (payé − remboursé)) des rendez-vous non annulés de la période |
| Charges décaissées | consommables + produits + coûts directs (lignes figées) + énergie et péages/stationnement/frais par trajet + frais de paiement Stripe (+ ajustements) |
| Coûts estimés | usure du véhicule (ou coût kilométrique global) ; la valorisation du temps de trajet est affichée mais **hors marge** |
| Charges fixes | montant × (12, 4 ou 1) × jours communs à la période et à la charge / 365 (fuseau de l'entreprise) |
| Marge contributive | CA réalisé HT − charges décaissées − usure estimée ; taux = marge / CA HT |
| Résultat d'exploitation estimé | marge − charges fixes |
| Cotisations, provision | taux saisi × (CA HT réalisé **ou** max(0, résultat)) selon le choix de la professionnelle ; aucun taux par défaut |
| Revenu disponible estimé | résultat − cotisations − provision (estimation de gestion, pas un solde bancaire) |
| Rentabilité horaire | marge × 60 / minutes mobilisées (préparation + prestation + nettoyage + tampon + trajet) |
| Rentabilité par prestation | coûts de trajet et frais de paiement d'un rendez-vous répartis au prorata du HT des prestations, temps au prorata des durées ; classements à partir de 5 réalisations |
| Simulation d'objectif | ⌈(objectif − (réalisé + prévisionnel)) / CA HT moyen des rendez-vous terminés des 90 derniers jours⌉ ; refusée sous 5 observations |

**Limites connues.** Les données d'une période sont chargées en mémoire (pagination de 1 000 lignes) : adapté à une activité individuelle, à revoir au-delà de quelques dizaines de milliers de rendez-vous. Le statut des comptes s'appuie sur `charges_enabled` (API v1) ; Stripe recommande désormais l'API Accounts v2 (migration prévue). Le traitement fiscal des arrhes conservées est une hypothèse affichée.

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
