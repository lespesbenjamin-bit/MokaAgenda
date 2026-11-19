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

## Tables futures (non créées — Sprint 2 et suivants)

`services` (dont `deposit_type`, `deposit_value`), `customers`, `appointments` (dont `status` `appointment_status`, `deposit_amount_cents`, `balance_due_cents`, `payment_status`), `payments`, `booking_holds` (réservation temporaire anti-conflit), `transport_profiles`, `financial_settings`. Chacune portera `business_id` et les mêmes politiques « membre / propriétaire ».
