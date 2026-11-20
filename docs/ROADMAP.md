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

## Sprint 3 — Agenda professionnel (non commencé, attend validation)

- Table `appointments` avec instantané financier, vues jour/semaine/mois, création d'un rendez-vous (prestation, cliente, lieu, durée, prix)

## Sprints suivants

- Réservation en ligne et moteur de disponibilités (disponibilités serveur, `booking_holds`, anti-conflit, confirmation automatique)
- Paiements Stripe (acomptes, solde restant, abonnements Solo / Complet), mode test en démo
- Tournées et temps de trajet
- Finances et rentabilité
- Boutique
