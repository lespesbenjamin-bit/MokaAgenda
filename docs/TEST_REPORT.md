# Rapport de tests — Sprint 1 (fiabilisation)

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
