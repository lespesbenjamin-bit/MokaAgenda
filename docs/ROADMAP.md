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

## Sprint 5 — Déplacements et tournées (développé, en attente de SQL + clé + recette)

- [x] Fournisseur : IGN Géoplateforme (géocodage BAN, itinéraires BD TOPO) via adaptateur remplaçable
- [x] Paramètres → Déplacements : points de départ/retour localisés, véhicule (6 types), coûts, marge de sécurité
- [x] Coût réel estimé (énergie, usure, temps, autres) sans double compte ; 5 modes de frais facturés
- [x] Zones : rayon routier, codes postaux, exclusions, supplément, minimum, jours ; carte
- [x] Agenda : trajets vérifiés avec le rendez-vous précédent ET suivant (base de données)
- [x] Mes tournées : carte, indicateurs, optimisation proposée puis appliquée sur validation (tout ou rien)
- [x] Réservation publique à domicile : adresse vérifiée, zone, frais, créneaux compatibles
- [x] Rentabilité indicative par rendez-vous ; instantanés des coûts et frais
- [x] Démo : 3 professionnelles (hybride, domicile, institut), véhicules et politiques de frais
- [ ] Exécuter la migration, installer la clé, recette manuelle
- Plus tard : trafic en temps réel (adaptateur Google Routes), recalcul du trajet réel depuis le rendez-vous précédent dans l'instantané, optimisation > 7 arrêts

## Sprint 6 — Finances et arrhes Stripe (développé, en attente de SQL + Stripe + recette)

- [x] Tableau de bord financier (périodes, CA réalisé/prévisionnel, encaissements, charges, résultats, évolution, répartitions)
- [x] Rentabilité par prestation (minimum 5 réalisations pour les classements) et par cliente
- [x] Paramètres financiers (régime, TVA, cotisations et provision paramétrables), charges fixes proratisées, objectifs + simulation
- [x] Stripe Connect (paiement direct, compte de la professionnelle, 0 % de commission Moka), onboarding, statut
- [x] Arrhes / acompte en ligne : réservation temporaire, Checkout, webhook signé et idempotent, paiement tardif, remboursement automatique
- [x] Règlements manuels validés explicitement, remboursements, contestations, virements, ajustements traçables
- [x] Exports CSV ; démo financière fictive
- [ ] Exécuter la migration, configurer Stripe (test), premier paiement test réel, recette
- Plus tard : migration vers l'API Accounts v2 de Stripe (recommandée par Stripe ; v1 + propriétés de contrôleur utilisée ici, toujours supportée), composants Stripe intégrés (bannière de notifications), paiement du solde en ligne

## Sprint 7 (non commencé, attend validation)

- Abonnements Moka (Solo / Complet), rappels automatiques par email (colonne `scheduled_for` prête), boutique — selon le brief du Sprint 7
