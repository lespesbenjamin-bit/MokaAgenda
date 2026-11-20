# Feuille de route

## Sprint 1 — Fondations (développé, en attente de recette sur Supabase/Vercel)

- [x] Socle Next.js, design system « Blanc vif », navigation responsive, pages « À venir »
- [x] Schéma SQL, contraintes, index, RLS, stockage des logos
- [x] Tests d'isolation multi-entreprises exécutés (PostgreSQL)
- [x] Authentification : inscription, vérification email, connexion, déconnexion, mot de passe oublié, protection des routes
- [x] Onboarding en 5 étapes persistant, avec reprise et logo
- [x] Tableau de bord branché sur l'entreprise connectée
- [x] Environnement démo : fixtures versionnées, bandeau, accès sans compte, réinitialisation sécurisée
- [ ] Recette manuelle sur les vrais projets Supabase et Vercel (voir `docs/SETUP.md` §4)
- [ ] SMTP personnalisé pour les emails de production

## Sprint 2 — Prestations et clientes (développé, en attente de recette)

- [x] Catégories : création, modification, ordre, masquer, archiver/restaurer
- [x] Prestations : formulaire complet (durées, tarifs domicile/institut, promo, supplément, TVA, coûts, réservation, acompte), photo
- [x] Liste : recherche, filtres (catégorie, statut, lieu), tri (nom, prix, durée), duplication, activation, archivage ; tableau sur ordinateur, cartes sur mobile
- [x] Rentabilité indicative avant déplacement
- [x] Clientes : liste, recherche (nom, email, téléphone), filtres, tri, fiche à onglets, adresses multiples, préférences, consentements, archivage, doublons
- [x] Import CSV en 7 étapes, idempotent
- [x] Démo : 6 catégories, 20 prestations, 25 clientes
- [x] Services prêts pour l'agenda (devis figé, recherche de cliente)
- [ ] Recette manuelle sur Supabase/Vercel (voir TEST_REPORT)
- [ ] Écran Paramètres (modification après onboarding, CGV) — reporté

## Sprint 3 — Agenda professionnel (développé, en attente de recette)

- [x] Tables rendez-vous, prestations figées, horaires, blocages, historique ; trajets et blocages en ligne préparés
- [x] Conflits, horaires, pauses, fermetures garantis par PostgreSQL (fuseau horaire et changement d'heure)
- [x] Protection contre les réservations simultanées
- [x] Agenda jour / semaine / mois, filtres, glisser-déposer (ordinateur), formulaire (mobile)
- [x] Fiche rendez-vous : statuts avec règles de passage, annulation motivée, historique
- [x] Horaires par jour avec lieu (hybride), congés, fermetures, indisponibilités
- [x] Tableau de bord : indicateurs réels de rendez-vous, prochains rendez-vous
- [x] Démo : horaires hybrides et rendez-vous fictifs cohérents
- [ ] Recette manuelle (voir SETUP §4 « Sprint 3 »)

## Sprint 4 — Réservation en ligne (développé, en attente de SQL + recette)

- [x] Adresse publique par professionnelle (`/reserver/<slug>`), générée automatiquement, modifiable
- [x] Page publique : logo, couverture, présentation, catégories, prestations, tarifs, durées, lieux, conditions, contact, partage
- [x] Parcours mobile en 6 étapes, sans compte ; créneaux calculés par le moteur de l'agenda
- [x] Confirmation : contrôle final en base, prix relus au catalogue, protection doubles clics et réservations simultanées
- [x] Prestations avec acompte non réservables en ligne (message explicatif)
- [x] Fiche cliente : réutilisation sans doublon (email puis téléphone), sans écraser les données existantes
- [x] Lien sécurisé : annulation et déplacement selon les règles de la professionnelle (figées à la réservation)
- [x] Emails : confirmation, alerte pro, annulation, modification ; journal `notifications` ; architecture prête pour les rappels
- [x] Sécurité : limitation de débit (IP + plafonds en base), validation stricte, piège anti-robots, en-têtes `no-referrer` / `noindex`
- [x] Démo : page publique fictive, rendez-vous « pris en ligne », confirmation simulée signalée
- [ ] Exécuter la migration, configurer Resend, recette manuelle

## Sprint 5 — Tournées et trajets (non commencé, attend validation)

## Sprint 6 — Paiements Stripe

- Acomptes en ligne : `booking_holds` pendant le paiement, statut « en attente » puis « confirmé » (tables et états prêts)

## Sprints suivants

- Paiements Stripe (solde restant, abonnements Solo / Complet), mode test en démo
- Rappels automatiques par email (colonne `scheduled_for` prête)
- Finances et rentabilité
- Boutique
