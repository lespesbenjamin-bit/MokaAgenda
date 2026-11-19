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

## Sprint 2 — non commencé (attend la validation du Sprint 1)

- Catalogue de prestations (durée, prix, lieu, acompte par prestation)
- Fichier clientes (CRM)
- Écran Paramètres (modification après onboarding, CGV)

## Sprints suivants

- Moteur de réservation (disponibilités serveur, `booking_holds`, anti-conflit, confirmation automatique)
- Paiements Stripe (acomptes, solde restant, abonnements Solo / Complet), mode test en démo
- Tournées et temps de trajet
- Finances et rentabilité
- Boutique
