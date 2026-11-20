# Schéma de base de données — Sprint 1

Source de vérité : `supabase/migrations/`. Toutes les tables ont la RLS activée.

## Tables créées

| Table | Rôle | Clés et contraintes principales |
|---|---|---|
| `profiles` | 1 ligne par compte (créée automatiquement à l'inscription) | PK = `auth.users.id` (cascade) |
| `platform_admins` | administrateurs Moka Studio (aucune interface) | PK = `auth.users.id` ; aucune politique → serveur uniquement |
| `businesses` | entreprise | nom 1–120 car. ; email au format valide ; `onboarding_step` 1–5 ; `created_by` → `auth.users` (set null) ; index sur `created_by` |
| `business_members` | qui accède à quelle entreprise | FK cascade vers `businesses` et `auth.users` ; unique (`business_id`, `user_id`) ; index sur `user_id` |
| `business_settings` | paramètres (1 par entreprise) | devise = EUR ; durée 5–480 min ; rayon 0–200 km ; fuseau validé par déclencheur |
| `locations` | adresses institut / point de départ | unique (`business_id`, `kind`) ; latitude/longitude bornées |
| `subscriptions` | abonnement (Stripe plus tard) | unique par entreprise ; ids Stripe uniques ; écriture serveur uniquement |

## Types énumérés

- `activity_mode` : home, salon, hybrid
- `member_role` : business_owner, staff
- `location_kind` : salon, travel_base
- `subscription_plan` : solo, complet · `subscription_status` : trialing, active, past_due, canceled, incomplete
- **Préparés** : `appointment_status` (pending, confirmed, completed, cancelled, no_show), `deposit_type` (none, fixed, percentage), `payment_status` (unpaid, deposit_pending, deposit_paid, paid, refunded, failed)

## Fonctions

| Fonction | Rôle |
|---|---|
| `public.create_business(name, activity, phone, email)` | crée entreprise + membre propriétaire + paramètres en une transaction ; idempotente |
| `private.is_business_member(id)` | utilisée par la RLS |
| `private.has_business_role(id, roles[])` | utilisée par la RLS |
| `private.is_platform_admin()` | préparatoire |
| `private.handle_new_user()` | crée le profil à l'inscription |

Le schéma `private` n'est pas exposé par l'API Supabase.

## Droits et politiques

| Table | Lecture | Écriture |
|---|---|---|
| profiles | soi-même | soi-même (`full_name`, `phone`) |
| businesses | membres | propriétaire, colonnes limitées (pas `created_by`) ; création via `create_business` |
| business_members | membres de l'entreprise | aucune (serveur) |
| business_settings | membres | propriétaire, colonnes limitées |
| locations | membres | propriétaire |
| subscriptions | membres | aucune (serveur) |
| platform_admins | aucune | aucune (serveur) |
| storage `business-logos` | public (URL), API : membres | propriétaire, dossier `{business_id}/` uniquement ; PNG/JPEG/WebP ≤ 2 Mo |

Le rôle `anon` (visiteur non connecté) n'a aucun droit sur ces tables.

## Sprint 2 — catalogue et clientes (migration `20261120000001_sprint2_catalog_crm.sql`)

| Table | Rôle | Points clés |
|---|---|---|
| `service_categories` | catégories de prestations | nom unique parmi les actives ; `position` ; `is_visible` ; archivage |
| `services` | prestations | durées (prestation, préparation, nettoyage, tampon, délai minimum) ; prix TTC en centimes ; promo ≤ prix ; supplément ; TVA en points de base (0, 550, 1000, 2000) ; acompte (aucun / fixe en centimes / pourcentage 0–100) ; nom unique parmi les actives ; archivage |
| `service_locations` | lieux proposés (`home`, `salon`) et tarif propre (null = prix de base) | unique (entreprise, prestation, lieu) |
| `service_costs` | coûts internes (`consumables`, `products`, `other`) | unique (entreprise, prestation, type) ; montants ≥ 0 |
| `customers` | fiches clientes | prénom ou nom obligatoire ; `email_normalized` et `phone_normalized` calculés par la base ; `contact_preference` ; `source` (manuel, import, réservation) ; `import_key` unique (import idempotent) ; archivage |
| `customer_addresses` | adresses (domicile, travail, autre) | une seule principale par cliente ; latitude/longitude uniquement si `geocoded_at` est renseigné (aucune coordonnée inventée) |
| `customer_consents` | consentements marketing par canal (email, SMS) | un par canal ; date et auteur de l'enregistrement |

**Verrous entre entreprises** : les tables liées référencent leur parent par une clé étrangère **composite** `(id, business_id)`. Il est donc impossible, au niveau de la base, de classer une prestation dans la catégorie d'une autre entreprise ou d'ajouter une adresse à la cliente d'une autre entreprise. `business_id` ne peut pas être modifié (déclencheur), `created_by` / `updated_by` sont posés par la base.

**Suppression** : aucune suppression des catégories, prestations et fiches clientes (archivage). Les tarifs par lieu, coûts et adresses peuvent être supprimés.

**Fonction** : `public.duplicate_service(id)` — copie atomique d'une prestation avec ses tarifs et coûts, inactive par défaut, nommée « (copie) », soumise à la RLS de l'appelante.

**Stockage** : bucket `service-photos` (même règles que les logos, propriétaire uniquement).

**Droits Sprint 2**

| Données | Lecture | Écriture |
|---|---|---|
| Catalogue (catégories, prestations, tarifs, coûts, photos) | membres | propriétaire |
| Clientes, adresses, consentements | membres | propriétaire + staff |

## Sprint 3 — agenda (migration `20261121000001_sprint3_agenda.sql`)

Extension : `btree_gist` (schéma `extensions`), pour les contraintes d'exclusion.

| Table | Rôle | Points clés |
|---|---|---|
| `availability_rules` | plages de travail hebdomadaires | jour ISO 1–7, minutes de début/fin, `place` (null = domicile et institut) ; **aucun chevauchement** le même jour (exclusion) ; une pause = intervalle entre deux plages |
| `availability_exceptions` | congés, fermetures, indisponibilités | `kind`, période `starts_at`/`ends_at` (≤ 1 an), `place` facultatif |
| `appointments` | rendez-vous | cliente (FK composite), lieu, statut, début, durées (prestation, préparation, nettoyage, tampon), `ends_at` et `occupied` calculés, adresse figée (obligatoire à domicile), montants figés (total, acompte, solde), notes, annulation ; **aucun chevauchement entre rendez-vous actifs** (exclusion sur `occupied`) |
| `appointment_items` | prestations du rendez-vous : **instantané** | nom, durée, prix catalogue et prix appliqué (`price_overridden`), TVA, HT, acompte, coûts (consommables, produits, autres) ; lien vers la prestation conservé même archivée |
| `booking_events` | historique | `created`, `updated`, `rescheduled`, `status_changed`, `cancelled` ; écrit **uniquement par la base** (déclencheur), lecture seule |
| `appointment_travel` | préparée (Sprint 5) | distance, durée, frais : renseignés seulement avec `computed_at` (aucune valeur inventée) |
| `booking_holds` | préparée (Sprint 6) | blocage temporaire d'un créneau pendant le paiement ; aucune politique → serveur uniquement ; déjà pris en compte par la réservation publique |

**Garanties PostgreSQL (déclencheurs sur `appointments`)**

1. `10_compute` : `ends_at` = début + durée ; `occupied` = [début − préparation, fin + nettoyage + tampon[.
2. `20_status` : transitions autorisées — en attente → confirmé | annulé ; confirmé → terminé | annulé | absente ; terminé / annulé / absente définitifs (horaires figés) ; « terminé » et « absente » seulement après le début.
3. `30_availability` (rendez-vous actifs) : dans le **fuseau horaire de l'entreprise**, le temps bloqué doit tenir entièrement dans **une** plage du bon jour compatible avec le lieu (refuse pause, dépassement, jour fermé, mauvais lieu) et ne toucher aucun blocage.
4. `appointments_no_overlap` : contrainte d'exclusion entre rendez-vous actifs.
5. `appointments_log` : historique automatique.

**Fonctions** : `create_appointment(p jsonb)`, `update_appointment(id, p jsonb)` (atomiques, soumises à la RLS, verrou transactionnel par entreprise `private.lock_schedule` contre les réservations simultanées), `replace_availability_rules(business, rules)` (tout ou rien).

**Droits Sprint 3** : horaires et blocages — lecture membres, écriture propriétaire ; rendez-vous et prestations du rendez-vous — lecture membres, écriture propriétaire + staff, **aucune suppression** (annulation) ; historique — lecture seule.

**Hypothèse V1** : un seul agenda par entreprise. L'agenda par employée ajoutera une colonne (ex. `staff_id`) à la contrainte d'exclusion.

## Sprint 4 — Réservation en ligne (`20261122000001_sprint4_public_booking.sql`)

| Changement | Détail |
|---|---|
| `businesses.slug` | adresse publique `/reserver/<slug>` ; unique, format contrôlé ; générée depuis le nom (comptes existants inclus, sans autre modification) ; modifiable par la propriétaire |
| `business_settings` + 13 colonnes | `booking_enabled` (**faux par défaut**), présentation, couverture, coordonnées publiques, Instagram, politique d'annulation, délai (h), annulation / déplacement autorisés, horizon (jours), pas des créneaux, email d'alerte |
| `appointments` + 4 colonnes | `customer_comment`, `conditions_snapshot` (règles et coordonnées **figées** à la réservation), `idempotency_key` (unique par entreprise), `public_token_hash` (SHA-256 du lien secret) |
| `notifications` (nouvelle) | journal des emails : type, destinataire, statut (`pending`, `sent`, `failed`, `skipped`, `simulated`), `scheduled_for` (rappels futurs), fournisseur, erreur ; lecture membres, écriture propriétaire + staff |

**Fonctions publiques** (exécutables par `anon`, security definer, `search_path` vide) : `public_booking_page`, `public_availability`, `public_create_booking`, `public_get_booking`, `public_cancel_booking`, `public_reschedule_booking`, `public_record_notification`. Elles ne renvoient jamais l'adresse de départ des déplacements, les motifs des blocages ni aucune autre cliente.

**Règles appliquées par `public_create_booking`** : page activée ; prestation active, réservable en ligne, non archivée, proposée à ce lieu et **sans acompte** ; délai minimum et horizon ; grille de 5 min ; adresse complète à domicile (code postal à 5 chiffres) ; plafonds anti-abus (30 réservations en ligne / heure / entreprise, 3 / 24 h / contact) ; verrou `lock_schedule` ; blocages `booking_holds` actifs ; mêmes déclencheurs et contrainte d'exclusion que l'agenda ; fiche cliente retrouvée par email puis téléphone **sans écraser** les données (seuls les champs vides sont complétés) ; statut `confirmed`, source `online`.

**Annulation / déplacement par la cliente** : selon les règles figées dans `conditions_snapshot` (délai, autorisations) ; 3 déplacements maximum ; historique automatique (auteur vide = cliente).

## Sprint 5 — Déplacements (`20261123000001_sprint5_travel.sql`)

| Table / changement | Rôle | Accès |
|---|---|---|
| `private.app_secrets` | clé HMAC `travel_signing` générée en base | aucun rôle client |
| `travel_settings` (1 par entreprise, créée automatiquement, **désactivée**) | départ/retour, marge (% et min), mode de frais, forfait, €/km, km inclus, min, max, seuil « offert au-delà », TVA des frais, `version` incrémentée à chaque modification | lecture membres, écriture propriétaire (colonnes autorisées) |
| `vehicles` | type, consommation, prix de l'énergie et usure (millièmes d'€), coût global/km facultatif (remplace énergie + usure), frais fixes, stationnement, coût horaire ; un seul par défaut | lecture membres, écriture propriétaire |
| `service_areas` | rayon ROUTIER ou codes postaux, exclusion, supplément, minimum de commande, jours, priorité | idem |
| `geocoded_addresses` | cache de géocodage par entreprise | membres |
| `travel_estimates` | trajets (distance m, durée s, fournisseur, expiration 90 j, tracé) | lecture membres ; écriture UNIQUEMENT via `record_travel_estimate` (signature) |
| `locations` + `geocoded_at`, `geocode_label` | points de départ localisés (coordonnées validées obligatoires) | propriétaire |
| `appointments` + `latitude`, `longitude`, `travel_check` | arrêt du rendez-vous ; `verified` / `not_required` / `skipped_by_pro` | RLS existante |
| `appointment_items` + `kind` | `service` ou `travel_fee` | RLS existante |
| `appointment_travel` + coûts | instantané : distance, durée, frais, zone, énergie, usure, temps, autres, coût total, véhicule, version des réglages | RLS existante |
| `route_plans`, `route_plan_stops` | propositions d'optimisation (`proposed` → `applied`) | membres ; écriture propriétaire + staff |
| `appointments_no_overlap` | désormais `deferrable initially immediate` (immédiate sauf dans `apply_route_plan`) | — |

**Fonctions** : `record_travel_estimate` (anon/authenticated, signature obligatoire, ≤ 1 j), `server_travel_context` (preuve serveur ≤ 5 min ; arrêts et point de départ), `public_travel_info` (tarifs publics, aucune adresse), `public_booking_coords` (coordonnées du rendez-vous du lien secret), `apply_route_plan` (authenticated), `create_appointment` / `update_appointment` / `public_create_booking` mis à jour. Règles internes : `private.travel_fee_cents`, `private.resolve_area`, `private.travel_cost`, `private.appointment_check_travel` (déclencheur `appointments_35_travel`).

## Sprint 6 — Finances et paiements (`20261124000001_sprint6_finances_paiements.sql`)

| Table | Rôle | Accès |
|---|---|---|
| `financial_settings` | régime, statut TVA, taux de cotisations et de provision (points de base) et leur base, nature arrhes/acompte, texte affiché ; versionnée | propriétaire (lecture + écriture par colonnes) ; créée pour chaque entreprise |
| `fixed_expenses` | charges fixes : catégorie, montant, fréquence, début/fin, archivage | propriétaire |
| `financial_goals` | objectifs mensuels (CA HT, revenu disponible, RDV, marge/heure) | propriétaire |
| `payment_accounts` | compte Stripe connecté (`acct_…`), mode, paiements/virements activés, informations manquantes | lecture propriétaire ; écriture par opération serveur signée |
| `booking_holds` (complétée) | statut (`open`, `converted`, `expired`, `cancelled`, `refund_required`), charge utile de la réservation, lien chiffré, montants, coordonnées vérifiées, session Checkout unique | aucune politique (serveur) |
| `payments` | registre : type (arrhes, solde, autre), moyen, statut (`pending` → `succeeded`/`cancelled`), montant, devise, frais Stripe, identifiants Stripe uniques, validation | lecture propriétaire ; **aucune écriture directe** ; immuable (déclencheur) |
| `refunds` | remboursements (demandé → en cours → effectué/échoué), motif, identifiant Stripe unique | idem ; somme plafonnée au montant payé |
| `payment_disputes`, `payouts` | contestations, virements Stripe vers la banque | lecture propriétaire |
| `payment_events` | journal des événements Stripe (identifiant, type, statut de traitement, essais, erreur courte ; aucun contenu personnel) | lecture propriétaire |
| `financial_adjustments` | écritures d'ajustement signées (montant ≠ 0, motif obligatoire) | propriétaire : insertion seule |

**Fonctions** : `private.online_booking` (ancien corps de `public_create_booking` + arrhes + essai complet + réservation temporaire ; `public_create_booking` l'appelle), `private.confirm_paid_hold`, `public.server_payment_op` (opérations signées : `event_begin/finish`, `account_link/sync`, `checkout_attach/expired/completed`, `hold_cancel`, `payment_fee`, `refund_sync`, `dispute_sync`, `payout_sync`, `reconcile_targets`), `public.record_manual_payment`, `public.validate_manual_payment`, `public.request_refund`, `public.public_hold_status`, `public.public_payment_info`, `private.refresh_payment_status` (statut `payment_status` du rendez-vous recalculé depuis le registre).

**Immuabilité** : `payments_guard`, `refunds_guard`, `adjustments_guard` refusent modification et suppression (sauf suppression en cascade d'une entreprise entière, ex. réinitialisation de la démo).

## Instantanés financiers

`appointment_items` est l'instantané figé (prix, TVA, HT, acompte, coûts directs) : base des analyses du Sprint 6. Un changement de tarif du catalogue ne modifie jamais un rendez-vous existant (testé).

## Tables futures (non créées)

`transport_profiles` (remplacé par `vehicles`, Sprint 5). Les autres tables prévues existent désormais.
