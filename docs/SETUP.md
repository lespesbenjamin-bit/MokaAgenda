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

### Sprint 6 — finances et arrhes
- [ ] Paramètres → Finances : régime, statut TVA, taux de cotisations (le vôtre), une charge fixe (loyer) ; Enregistrer
- [ ] Finances : choisir « Ce mois », puis une période personnalisée ; vérifier que les rendez-vous **terminés** comptent dans le réalisé et les rendez-vous à venir dans le prévisionnel
- [ ] Fiche d'un rendez-vous terminé : « Enregistrer un règlement » sans cocher la confirmation → « À valider », non compté ; « Valider » → compté dans « Encaissé »
- [ ] Rembourser une partie de ce règlement → l'encaissé net baisse ; une écriture d'ajustement apparaît dans Finances → Paiements quand vous en saisissez une
- [ ] Finances → Exports : ouvrir chaque CSV dans un tableur
- [ ] Objectifs : saisir un objectif de CA → progression et simulation
- [ ] (Après §7) Paramètres → Paiement en ligne → « Connecter mon compte Stripe » (mode test) → retour sur Moka : « Paiements acceptés »
- [ ] Mettre des arrhes de 30 % sur une prestation ; page publique en navigation privée → « Payer … et réserver » → carte de test `4242 4242 4242 4242`, date future, CVC 123 → retour « Confirmation en cours » puis page du rendez-vous confirmé ; l'agenda affiche le RDV, Finances → Paiements affiche l'encaissement et les frais Stripe
- [ ] Recommencer et cliquer « Retour » sur la page Stripe → « Paiement non finalisé » → « Annuler cette réservation » → le créneau redevient libre
- [ ] Carte refusée `4000 0000 0000 0002` → Stripe affiche le refus, aucun rendez-vous créé
- [ ] Rembourser les arrhes depuis la fiche du rendez-vous → statut « effectué » après confirmation Stripe

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

## 7. Paiement en ligne des arrhes (Stripe Connect) — Sprint 6

Modèle : **paiement direct** sur le compte Stripe de chaque professionnelle (Stripe Connect). L'argent ne transite jamais par le compte Moka ; Moka ne prend pas de commission ; chaque professionnelle paie elle-même les frais Stripe sur son compte. Aucun numéro de carte n'est stocké par Moka.

**Commencer en mode TEST** (aucun argent réel) :

1. Créer un compte sur https://dashboard.stripe.com/register (compte « plateforme » de Moka). Rester en **mode test** (interrupteur « Test mode »).
2. **Connect → Get started** : choisir une plateforme où les professionnelles « vendent directement » (paiements directs), compte avec **tableau de bord Stripe complet**. Valider le profil de plateforme demandé par Stripe.
3. **Developers → API keys** : copier la **Secret key** `sk_test_...`.
4. **Developers → Webhooks → Add endpoint** :
   - URL : `https://moka-agenda.vercel.app/api/stripe/webhook`
   - **Listen to : Events on Connected accounts**
   - Événements : `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `account.updated`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`
   - Copier le **Signing secret** `whsec_...`
5. Vercel → `moka-agenda` → Settings → Environment Variables (Production et Preview) :
   - `STRIPE_SECRET_KEY` = `sk_test_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...`
   - `CRON_SECRET` = 32 caractères aléatoires ou plus (réconciliation quotidienne `/api/stripe/reconcile`, déjà planifiée dans `vercel.json`)
6. Redéployer, puis Paramètres → Paiement en ligne → « Connecter mon compte Stripe ».

Garde-fous : une clé `sk_live_` est **refusée** hors production (démo, poste local). La démo n'utilise que des clés de test. Passer en réel = remplacer les deux valeurs par les clés **live** et créer le webhook en mode live — à faire seulement après validation de la recette et relecture juridique des conditions (arrhes / acompte).

Variables : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` (serveur uniquement, jamais `NEXT_PUBLIC_`). La signature des opérations de paiement réutilise `TRAVEL_SIGNING_SECRET` (§6).
