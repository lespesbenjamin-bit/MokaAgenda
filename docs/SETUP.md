# Mise en service — Supabase, Vercel, démo

Procédure pas à pas. Rien ici ne supprime de données existantes : les migrations
créent des tables neuves et **échouent** (sans rien écraser) si une table du même
nom existe déjà. Utilisez des projets Supabase **dédiés** à Moka Réservation.

## 1. Projet Supabase de production

1. Créer un projet `moka-prod` (région Europe, ex. Paris `eu-west-3`).
2. **SQL Editor** → exécuter, dans l'ordre, chaque fichier de `supabase/migrations/` :
   1. `20261119000001_sprint1_foundations.sql`
   2. `20261119000002_storage_business_logos.sql`
   3. `20261120000001_sprint2_catalog_crm.sql` (Sprint 2)
   4. `20261121000001_sprint3_agenda.sql` (Sprint 3)
3. **Authentication → Sign In / Providers → Email** : *Confirm email* activé ; longueur minimale du mot de passe : 8.
4. **Authentication → URL Configuration** :
   - Site URL : `https://VOTRE-DOMAINE-PROD`
   - Redirect URLs : `https://VOTRE-DOMAINE-PROD/auth/confirm`, `http://localhost:3000/auth/confirm` et, pour les prévisualisations Vercel, `https://*-VOTRE-COMPTE.vercel.app/auth/confirm`
5. **Authentication → Emails → Templates** (recommandé : liens valables sur n'importe quel appareil) :
   - *Confirm signup* : remplacer le lien par `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - *Reset password* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   Sans cette modification, les liens fonctionnent aussi, mais seulement s'ils sont ouverts dans le même navigateur que celui de l'inscription.
6. **SMTP** : l'envoi intégré de Supabase est limité à quelques emails par heure. Avant d'ouvrir aux clientes, configurer un SMTP (ex. Resend) dans *Authentication → Emails → SMTP Settings*.

## 2. Vercel — projet de production

*Settings → Environment Variables* (Production **et** Preview) :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `production` |
| `NEXT_PUBLIC_SITE_URL` | `https://VOTRE-DOMAINE-PROD` |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet `moka-prod` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clé publishable (ou anon) de `moka-prod` |

⚠️ Ne **pas** ajouter `SUPABASE_SERVICE_ROLE_KEY` en production : elle n'y sert à rien.
Après modification des variables : *Deployments → … → Redeploy*.

## 3. Environnement de démonstration

1. Créer un **second** projet Supabase `moka-demo` et y exécuter les mêmes migrations et réglages (étape 1).
2. Créer un **second** projet Vercel `moka-reservation-demo` importé depuis le **même** dépôt GitHub.
3. Variables de ce projet :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `demo` |
| `NEXT_PUBLIC_SITE_URL` | URL du projet démo |
| `NEXT_PUBLIC_SUPABASE_URL` / `…_PUBLISHABLE_KEY` | ceux de `moka-demo` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé *secret / service_role* de `moka-demo` |
| `DEMO_SUPABASE_PROJECT_REF` | identifiant de `moka-demo` (sous-domaine de son URL) |
| `PRODUCTION_SUPABASE_PROJECT_REF` | identifiant de `moka-prod` (garde-fou) |
| `DEMO_USER_EMAIL` | ex. `demo@moka-reservation.demo` |
| `DEMO_USER_PASSWORD` | mot de passe fort |
| `CRON_SECRET` | 32+ caractères aléatoires |

4. Première initialisation (puis automatique chaque nuit à 4 h UTC) :
   ```bash
   curl -X POST https://URL-DEMO/api/demo/reset -H "Authorization: Bearer VOTRE_CRON_SECRET"
   ```
   Réponse attendue : `{"ok":true,"businessId":"…"}`.

La réinitialisation **vide entièrement la base démo** puis recrée « Moka Beauty Studio ».
Elle refuse de s'exécuter si l'application n'est pas en mode démo, si l'URL Supabase
ne correspond pas à `DEMO_SUPABASE_PROJECT_REF`, ou si elle correspond au projet de production.
La tâche planifiée existe aussi sur le projet de production, où la route répond 404 sans rien faire.

## Variables d'environnement

Les Sprints 2 et 3 n'ajoutent **aucune** variable en production. Le Sprint 4 ajoute deux variables **facultatives** pour les emails : `RESEND_API_KEY` et `EMAIL_FROM` (voir §5). Sans elles, la réservation fonctionne mais aucun email n'est envoyé. `MOKA_UI_PREVIEW=1` sert uniquement en local pour l'aperçu des écrans ; ne jamais la définir sur Vercel.

## 4. Recette manuelle (à faire une fois configuré)

- [ ] Inscription → email reçu → lien → arrivée sur l'onboarding
- [ ] Onboarding 5 étapes avec logo ; fermer l'onglet à l'étape 3, se reconnecter → reprise à l'étape 3
- [ ] Tableau de bord : nom, logo, mode et adresses affichés, aucun chiffre fictif
- [ ] Déconnexion → les pages privées redirigent vers la connexion
- [ ] Mot de passe oublié → email → nouveau mot de passe → connexion
- [ ] Second compte : il ne voit pas l'entreprise du premier
- [ ] Démo : bouton « Explorer la démo », bandeau visible, chiffres marqués fictifs

### Sprint 2
- [ ] Créer 2 catégories, les réordonner, en masquer une
- [ ] Créer une prestation domicile + institut avec tarif domicile différent, coûts et acompte 30 % ; vérifier la marge affichée
- [ ] Tenter un acompte fixe supérieur au prix → message d'erreur
- [ ] Dupliquer, désactiver, archiver puis restaurer une prestation
- [ ] Créer une cliente avec adresse ; en recréer une avec le même téléphone → alerte doublon
- [ ] Ajouter une adresse travail, la définir principale
- [ ] Importer un CSV de 3 lignes, puis réimporter le même fichier → « Déjà importée »
- [ ] Recharger la page : tout est conservé

### Sprint 3
- [ ] Agenda › Horaires : lundi 9h–12h institut + 14h–18h domicile, mardi 9h–18h, mercredi fermé ; enregistrer
- [ ] Créer un rendez-vous lundi 10h en institut → visible dans l'agenda et le tableau de bord
- [ ] Tenter lundi 12h30 (pause) puis mercredi (fermé) → refus clair avec créneaux proposés
- [ ] Tenter un second rendez-vous à 10h30 le même lundi → refus (chevauchement)
- [ ] Rendez-vous lundi 15h à domicile → adresse de la cliente reprise automatiquement
- [ ] Sur ordinateur, glisser un rendez-vous vers un autre créneau ; sur téléphone, « Modifier ou déplacer »
- [ ] Bloquer une journée de congé, puis tenter un rendez-vous ce jour-là → refus
- [ ] Annuler un rendez-vous avec un motif → historique mis à jour, créneau libéré
- [ ] Changer le prix d'une prestation au catalogue → le rendez-vous existant garde l'ancien prix

### Sprint 5 — déplacements
- [ ] Paramètres → Déplacements : « Localiser » le départ des tournées (et l'institut) → adresse reconnue affichée
- [ ] Renseigner le véhicule (remplacer les estimations), cocher « Prendre en compte les trajets », mode « au km », enregistrer
- [ ] Zones : ajouter « Ville » (rayon 15 km) et une zone exclue (un code postal) ; la carte affiche le point de départ et le cercle
- [ ] Agenda : créer un RDV à domicile 9 h–10 h (adresse réelle d'une amie, avec accord), puis un autre à 10 h 05 à 15 km → refus « trajet trop court » ; à 10 h 45 → accepté
- [ ] Le détail du RDV affiche le trajet de référence, les frais et la rentabilité
- [ ] Page publique en navigation privée : prestation à domicile → adresse → frais et total affichés → seuls des créneaux compatibles ; adresse dans la zone exclue → refus clair
- [ ] Mes tournées : carte, ordre, km et coût ; « Optimiser ma tournée » → proposition, rien ne change tant qu'on n'a pas validé
- [ ] Désactiver les déplacements → l'agenda accepte de nouveau deux RDV rapprochés (comportement d'avant)

### Sprint 4 — réservation en ligne
- [ ] Paramètres → Réservation en ligne : cocher « Activer », renseigner présentation, téléphone, politique d'annulation ; Enregistrer
- [ ] Cliquer « Voir ma page » : logo, présentation, prestations et prix corrects ; prestations avec acompte affichées mais non réservables
- [ ] Sur téléphone (navigation privée, sans être connectée) : réserver une prestation en institut → page « Votre rendez-vous est confirmé »
- [ ] Le rendez-vous apparaît dans l'Agenda (badge « Réservé en ligne ») et la fiche cliente est créée
- [ ] Recharger la page publique : le créneau réservé n'est plus proposé
- [ ] Réserver à domicile avec un code postal à 4 chiffres → message d'erreur ; corriger → OK, adresse dans la fiche cliente
- [ ] Refaire une réservation avec le même email → rattachée à la même fiche (pas de doublon)
- [ ] Depuis le lien de gestion : déplacer, puis annuler → l'agenda se met à jour
- [ ] Dans Paramètres, mettre « 720 h » avant, faire une réservation à J+3 → l'annulation en ligne est refusée
- [ ] Désactiver la page → `/reserver/...` affiche « Réservation en ligne indisponible »
- [ ] (Si Resend configuré) emails reçus : confirmation cliente, alerte professionnelle, annulation, modification

## 5. Emails de réservation (Resend) — facultatif

1. Créer un compte sur https://resend.com (gratuit jusqu'à 3 000 emails/mois).
2. **Domains → Add domain** : ajouter votre domaine (ex. `mokastudio.fr`) puis copier les enregistrements DNS indiqués chez votre hébergeur de domaine ; attendre « Verified ».
   Sans domaine vérifié, Resend n'envoie qu'à l'adresse du compte (suffisant pour un test).
3. **API Keys → Create API key** (permission « Sending access ») : copier la clé `re_...`.
4. Vercel → projet `moka-agenda` → Settings → Environment Variables (Production) :
   - `RESEND_API_KEY` = la clé `re_...`
   - `EMAIL_FROM` = `Moka Réservation <reservations@votre-domaine.fr>`
5. Vercel → Deployments → ⋯ → Redeploy.
6. Paramètres → la carte « Emails automatiques » doit indiquer « Actifs ».

⚠️ Ne jamais définir ces variables sur le projet **démo** : la démo simule les emails quoi qu'il arrive.

## 6. Déplacements : clé de signature (Sprint 5, obligatoire pour activer les trajets)

La base n'accepte que des trajets signés par le serveur. La clé est créée **dans Supabase** par la migration :

1. Supabase → SQL Editor → New query → exécuter :
   ```sql
   select value from private.app_secrets where name = 'travel_signing';
   ```
   Copier la valeur (64 caractères). Ne la collez nulle part ailleurs que dans Vercel.
2. Vercel → projet `moka-agenda` → Settings → Environment Variables → `TRAVEL_SIGNING_SECRET` = la valeur (Production et Preview).
3. Redéployer (Deployments → ⋯ → Redeploy).
4. Paramètres → Déplacements : l'encadré « Configuration » doit indiquer « Clé de signature des trajets installée ».

Projet démo : même procédure avec la base démo (sa clé est différente).

Fournisseur : IGN Géoplateforme, gratuit et sans clé. Limites publiques : géocodage 50 requêtes/s, itinéraire 5 requêtes/s par adresse IP. Aucun compte à créer.
