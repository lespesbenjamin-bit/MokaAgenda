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

## Instantanés financiers des futurs rendez-vous

Préparés côté code (`AppointmentPriceSnapshot` dans `src/lib/domain/pricing.ts`) : prestation, lieu, durées, prix TTC/HT, TVA, supplément, acompte, solde, coûts directs, date. Ils seront enregistrés dans `appointments` au Sprint 3 pour qu'un changement de tarif ne modifie pas l'historique.

## Tables futures (non créées)

`appointments` (dont `status` `appointment_status`, instantané financier, `deposit_amount_cents`, `balance_due_cents`, `payment_status`), `payments`, `booking_holds` (réservation temporaire anti-conflit), `transport_profiles`, `financial_settings`. Chacune portera `business_id`, des clés composites vers les tables existantes et les mêmes politiques.
