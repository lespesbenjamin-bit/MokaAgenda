# Rapport de tests

## Sprint 3 — Agenda et disponibilités (20 novembre 2026)

Branche : `sprint-3-agenda`. Seuls les tests réellement exécutés sont indiqués comme réussis.

### Synthèse des exécutions

| Suite | Commande | Résultat |
|---|---|---|
| Typage TypeScript strict | `npm run typecheck` | ✅ 0 erreur |
| Lint | `npm run lint` | ✅ 0 erreur, 0 avertissement |
| Tests unitaires | `npm test` | ✅ 103 / 103 (dont 15 nouveaux pour le moteur de disponibilités et les statuts) |
| Base de données + RLS (PostgreSQL 16) | `npm run test:db` | ✅ 103 / 103 (dont 35 Sprint 3 et 3 sur l'agenda démo) |
| HTTP — build production | `npm run test:e2e:all` | ✅ 35 / 35 |
| HTTP — build sans configuration | idem | ✅ 2 / 2 |
| HTTP — build démo | idem | ✅ 36 / 36 |
| Non-régression Sprints 1 et 2 | toutes les suites | ✅ |

**Contrôle des tests** : en supprimant la contrainte anti-chevauchement et le contrôle des horaires, 11 tests échouent. Les tests détectent donc l'absence de ces protections.

### Couverture

- **Création** : horaires calculés, montants figés (total, acompte, solde), prestation figée, historique « créé » avec l'auteur ; refus sans prestation.
- **Modification / déplacement** : déplacement historisé ; déplacement vers un créneau occupé refusé **sans rien modifier** ; changement de prestation avec recalcul des montants ; prix ajusté manuellement sans toucher au catalogue.
- **Annulation et statuts** : transitions autorisées et refusées, « terminé » / « absente » impossibles avant l'heure, rendez-vous clôturé non modifiable, annulation datée qui libère le créneau, historique en lecture seule et impossible à effacer.
- **Conflits** : chevauchement refusé, rendez-vous accolés acceptés, préparation et temps tampon pris en compte.
- **Horaires** : pause, durée dépassant la plage, jour fermé, avant ouverture, alternance domicile / institut d'une hybride, adresse obligatoire à domicile, congés et indisponibilité limitée à un lieu, plages qui se chevauchent refusées, enregistrement des horaires tout ou rien.
- **Prestations de durées différentes** : 15 min à 2 h 30 (démo) ; 30 min + 15 min de tampon (tests).
- **Changement de tarif après réservation** : le rendez-vous garde son prix ; une prestation archivée reste identifiable.
- **Isolation (2 entreprises + staff + visiteur)** : aucune lecture croisée (rendez-vous, prestations du rendez-vous, horaires, blocages, historique) ; impossible de modifier, annuler ou déplacer chez l'autre, ni de créer un rendez-vous chez l'autre ou avec sa cliente, son adresse ou sa prestation ; les agendas de deux entreprises ne se gênent pas ; le staff prend des rendez-vous mais ne modifie pas les horaires ; blocages de réservation en ligne inaccessibles.
- **Réservations simultanées** : deux connexions réservent le même créneau au même instant → une seule réussit, l'autre est refusée.
- **Fuseaux et changement d'heure** : jour du passage à l'heure d'été (28 mars 2027) correct ; entreprise en Martinique (UTC−4) contrôlée dans son propre fuseau ; conversions heure locale ↔ UTC testées en hiver, en été et le jour du changement.
- **Moteur côté application** : mêmes scénarios que PostgreSQL, créneaux libres (pauses, rendez-vous, délai minimum, jours fermés ou bloqués).
- **Démo** : horaires hybrides et plus de 20 rendez-vous réellement insérés dans PostgreSQL (horaires et absence de chevauchement vérifiés par la base), passés terminés / annulés / absents, futurs confirmés / en attente, adresses à domicile, prestation figée pour chacun ; annulation d'un rendez-vous démo.
- **HTTP** : 4 nouvelles pages privées redirigent vers la connexion.
- **Visuel** (aperçu local, données démo, ordinateur 1440 px et mobile 390 px) : semaine, jour, mois, liste mobile, formulaire de rendez-vous, horaires et blocages. Corrections : filtre par défaut qui masquait les rendez-vous terminés, champs d'heure trop étroits en format 12 h.

### Ce qui n'a PAS pu être testé ici

| Point | Raison | Procédure |
|---|---|---|
| Appels réels de l'application vers Supabase (création, déplacement, statut depuis l'interface) | pas d'accès à votre projet ; serveurs Supabase locaux non téléchargeables dans cet environnement | `docs/SETUP.md` §4 « Sprint 3 » |
| Glisser-déposer réel dans un navigateur connecté | dépend du point précédent | idem |
| Réinitialisation démo avec l'agenda | projet démo non créé | `docs/SETUP.md` §3 |

Chaque opération de l'interface a son équivalent SQL testé avec les droits réels d'une utilisatrice.

---

## Sprint 2 — Prestations et CRM clientes (20 novembre 2026)

Branche : `sprint-2-prestations-clientes`. Seuls les tests réellement exécutés sont indiqués comme réussis.

### Synthèse des exécutions

| Suite | Commande | Résultat |
|---|---|---|
| Typage TypeScript strict | `npm run typecheck` | ✅ 0 erreur |
| Lint | `npm run lint` | ✅ 0 erreur, 0 avertissement |
| Tests unitaires | `npm test` | ✅ 88 / 88 (dont 41 nouveaux) |
| Base de données + RLS (PostgreSQL 16) | `npm run test:db` | ✅ 65 / 65 (34 Sprint 1 + 31 Sprint 2) |
| HTTP — build production | `npm run test:e2e:all` | ✅ 31 / 31 |
| HTTP — build sans configuration | idem | ✅ 2 / 2 |
| HTTP — build démo | idem | ✅ 32 / 32 |
| Non-régression Sprint 1 | toutes les suites ci-dessus | ✅ |

**Contrôle des tests RLS** : RLS désactivée sur `customers` et règle de modification des prestations ouverte → 5 tests échouent. Les tests détectent donc la faille. Pour les prestations, une seconde barrière (règle de lecture) bloquait encore la modification.

### Couverture

- **Prestations** : création et modification (validation du formulaire), duplication atomique avec tarifs et coûts, archivage et réutilisation d'un nom archivé, unicité des noms actifs, tarifs domicile/institut, promo, supplément, HT/TTC, marge indicative (positive, négative, prix nul), validation des acomptes (négatif, > 100 %, fixe > prix le plus bas), instantané pour un futur rendez-vous.
- **Clientes** : création, modification, recherche (nom sans accents, email, téléphone en tout format), adresses multiples avec une seule principale, coordonnées GPS refusées sans géocodage, consentements, normalisation email/téléphone identique entre application et base, doublons (email, téléphone, nom + date de naissance ; un homonyme n'est pas un doublon).
- **Import CSV** : séparateurs `,` `;` tabulation, guillemets, retours à la ligne, BOM, correspondance automatique des colonnes, dates françaises et ISO, erreurs par ligne, doublons avec l'existant et dans le fichier, idempotence (clé d'import unique en base).
- **Sécurité (2 entreprises, propriétaire + staff, visiteur)** : lecture, modification, archivage, suppression et duplication interdits chez l'autre entreprise ; rattachement croisé impossible (clés étrangères composites) pour prestation→catégorie, adresse, consentement, tarif et coût ; `business_id` non modifiable ; `created_by` non falsifiable ; staff : clientes oui, catalogue non ; photos dans le dossier de sa seule entreprise.
- **Démo** : les 6 catégories, 20 prestations, 25 clientes et 35 adresses sont réellement insérées dans PostgreSQL (contraintes + RLS) ; une adresse principale par cliente ; emails `@exemple.demo` ; aucune coordonnée GPS.
- **HTTP** : 6 nouvelles pages privées redirigent vers la connexion ; l'aperçu local répond 404 en production.
- **Visuel** (captures ordinateur 1440 px et mobile 390 px, via l'aperçu local avec données démo) : liste des prestations (tableau / cartes), formulaire avec calcul de marge en direct, catégories, liste et fiche clientes, adresses, import. Interactions vérifiées : filtre « à domicile » (12 prestations), tri, fenêtre de confirmation d'archivage, recherche cliente par téléphone et par nom sans accent, chargement d'un CSV et correspondance des colonnes.

### Corrections faites pendant le sprint

| Problème | Correction |
|---|---|
| Une contrainte d'unicité révélait l'existence d'un tarif chez une autre entreprise avant la clé étrangère | Unicité incluant `business_id` |
| Numéros `0033…` normalisés différemment en base et dans l'application | Même règle des deux côtés, testée |
| Boutons d'action sur deux lignes dans le tableau | Icônes avec info-bulle et libellé accessible |
| Filtres occupant tout l'écran mobile | Repliés derrière « Filtres et tri » |
| Adresses à l'étroit dans la fiche cliente | Cartes empilées |

### Ce qui n'a PAS pu être testé ici

| Point | Raison | Procédure |
|---|---|---|
| Requêtes de l'application envoyées à l'API Supabase réelle (PostgREST) et envoi de photos (Storage) | Pas d'accès à votre projet ; le téléchargement local des serveurs Supabase a été refusé par l'environnement | `docs/SETUP.md` §4 « Sprint 2 » |
| Parcours complet connecté dans le navigateur | Dépend du point précédent | idem |
| Réinitialisation démo avec les nouvelles données | Projet démo non créé | `docs/SETUP.md` §3 |

Les mêmes règles sont néanmoins vérifiées en base : chaque opération de l'application a son équivalent SQL testé avec les droits réels.

---

## Sprint 1 — Fondations

Date : 19 novembre 2026 · Branche : `sprint-1-5-fiabilisation`

Seuls les tests réellement exécutés sont indiqués comme réussis.

## 1. Synthèse des exécutions

| Suite | Commande | Environnement | Résultat |
|---|---|---|---|
| Typage TypeScript strict | `npm run typecheck` | local | ✅ 0 erreur |
| Lint (ESLint Next.js) | `npm run lint` | local | ✅ 0 erreur, 0 avertissement |
| Tests unitaires | `npm test` | Node 22 | ✅ 46 / 46 |
| Tests base de données + RLS | `npm run test:db` | PostgreSQL 16 local + reproduction Supabase | ✅ 34 / 34 |
| Tests HTTP — build production | `npm run test:e2e:all` | `next build` + `next start` | ✅ 24 / 24 |
| Tests HTTP — build sans config Supabase | idem | idem | ✅ 2 / 2 |
| Tests HTTP — build démo | idem | idem | ✅ 26 / 26 |
| Build de production | `npm run build` | avec et sans variables Supabase | ✅ |

**Contrôle des tests RLS** : en désactivant volontairement la RLS sur `businesses` et en ouvrant l'insertion des adresses, 6 tests échouent. Les tests détectent donc bien une faille.

## 2. Ce que couvrent les tests

**Isolation multi-entreprises (2 comptes, 2 entreprises, + 1 staff + 1 compte sans entreprise)** — A ne peut, sur l'entreprise B : ni lire l'entreprise, ses paramètres, membres, adresses, abonnement ; ni la modifier ; ni ajouter/modifier/supprimer une adresse ; ni s'ajouter comme membre ; ni déposer un fichier dans son dossier de logos. A ne peut pas non plus s'attribuer un abonnement, se déclarer administrateur, ni modifier `created_by`. Un visiteur non connecté n'a accès à aucune table. Le staff lit mais ne modifie pas. Aucune clé service_role n'est utilisée : rôle `authenticated` + JWT simulé.

**Contraintes** — devise EUR, fuseau horaire valide, étape d'onboarding 1–5, une adresse par type, suppression en cascade.

**Onboarding (niveau base)** — les 5 étapes rejouées avec les mêmes requêtes que l'application, puis relecture complète comme après reconnexion.

**Unitaires** — validation inscription / mot de passe / onboarding / logo, reprise d'étape, anti-redirection ouverte, protection des routes, configuration Supabase, garde-fous démo, cohérence des fixtures, non-renvoi des mots de passe dans les formulaires.

**HTTP** — pages publiques 200 ; 11 pages privées → `/connexion?next=…` ; faux cookie refusé ; lien email invalide géré ; `next=//evil.com` neutralisé ; 404 ; en-têtes de sécurité ; aucune clé secrète dans le JavaScript envoyé au navigateur ; route démo inexistante en production ; en démo : bandeau, bouton démo, réinitialisation refusée sans secret et refusée sur un projet qui n'est pas la démo.

**Visuel** — captures ordinateur et mobile : accueil, connexion, inscription (erreurs serveur affichées), connexion démo, tableau de bord.

## 3. Ce qui n'a PAS pu être testé ici

Ces points nécessitent les vrais projets Supabase et Vercel (non accessibles depuis l'environnement de développement) :

| Point | Pourquoi | Procédure |
|---|---|---|
| Envoi et clic des emails (confirmation, mot de passe) | service email Supabase | `docs/SETUP.md` §4 |
| Connexion réelle et persistance de session | serveur Supabase Auth | idem |
| Onboarding complet dans le navigateur, envoi réel du logo | Supabase Auth + Storage | idem |
| Affichage du tableau de bord connecté | dépend des précédents | idem |
| Réinitialisation démo réussie | nécessite le projet `moka-demo` | `docs/SETUP.md` §3 |
| Exécution des migrations sur Supabase hébergé | testé sur PostgreSQL 16 + reproduction ; Supabase utilise PostgreSQL 15/17 avec les mêmes fonctionnalités | coller le SQL dans le SQL Editor |

## 4. Problèmes trouvés et corrigés pendant cet audit

| Priorité | Problème | Correction |
|---|---|---|
| Bloquant | Authentification, base, onboarding, RLS et démo absents (seule l'étape 1 existait) | Développés |
| Bloquant | Sans variables Supabase, le build échouait (pages privées pré-rendues) | Lecture des cookies avant la configuration ; absence de config = non connectée |
| Important | Les champs saisis étaient effacés après une erreur de formulaire (React 19) | Valeurs renvoyées par le serveur (jamais les mots de passe) |
| Important | Une mise à jour bloquée par la RLS ne renvoie pas d'erreur (0 ligne) | Détection explicite du « 0 ligne » → refus |
| Important | Script de typage en échec sur un dépôt neuf (types de routes non générés) | `next typegen` avant `tsc` |
| Amélioration | Script de tests HTTP : serveur précédent resté actif sur le port | Arrêt complet entre deux configurations |
