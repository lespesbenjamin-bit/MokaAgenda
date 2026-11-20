import {
  LayoutDashboard,
  CalendarDays,
  Route,
  Users,
  Sparkles,
  Wallet,
  ShoppingBag,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ModuleStatus = "available" | "coming_soon";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  status: ModuleStatus;
  /** Description courte affichée sur le dashboard et les pages « À venir ». */
  summary: string;
  /** Fonctionnalités prévues — affichées uniquement comme feuille de route. */
  planned: string[];
  /** Visible dans la barre du bas sur mobile (les autres sont dans « Plus »). */
  mobilePrimary: boolean;
}

export const navigation: NavItem[] = [
  {
    key: "dashboard",
    label: "Tableau de bord",
    href: "/tableau-de-bord",
    icon: LayoutDashboard,
    status: "available",
    summary: "Vue d'ensemble de votre activité.",
    planned: [],
    mobilePrimary: true,
  },
  {
    key: "agenda",
    label: "Agenda",
    href: "/agenda",
    icon: CalendarDays,
    status: "available",
    summary: "Vos rendez-vous à domicile et en institut, au même endroit.",
    planned: [
      "Vue jour, semaine et mois",
      "Prévention des conflits de créneaux",
      "Acompte optionnel par prestation",
    ],
    mobilePrimary: true,
  },
  {
    key: "tours",
    label: "Mes tournées",
    href: "/tournees",
    icon: Route,
    status: "available",
    summary: "Vos déplacements du jour sur une carte, leur coût et l'ordre de passage optimisé.",
    planned: [],
    mobilePrimary: false,
  },
  {
    key: "customers",
    label: "Clientes",
    href: "/clientes",
    icon: Users,
    status: "available",
    summary: "Le fichier de vos clientes et leur historique.",
    planned: ["Fiches clientes", "Historique des rendez-vous", "Notes et préférences"],
    mobilePrimary: true,
  },
  {
    key: "services",
    label: "Prestations",
    href: "/prestations",
    icon: Sparkles,
    status: "available",
    summary: "Votre carte de soins, durées et tarifs.",
    planned: [
      "Catalogue de prestations",
      "Lieu : domicile, institut ou les deux",
      "Conditions d'acompte par prestation",
    ],
    mobilePrimary: false,
  },
  {
    key: "finances",
    label: "Finances",
    href: "/finances",
    icon: Wallet,
    status: "coming_soon",
    summary: "Chiffre d'affaires, acomptes et soldes restants.",
    planned: ["Suivi des acomptes et soldes", "Chiffre d'affaires", "Rentabilité des déplacements"],
    mobilePrimary: false,
  },
  {
    key: "shop",
    label: "Boutique",
    href: "/boutique",
    icon: ShoppingBag,
    status: "coming_soon",
    summary: "Vente de produits et cartes cadeaux.",
    planned: ["Catalogue produits", "Cartes cadeaux"],
    mobilePrimary: false,
  },
  {
    key: "settings",
    label: "Paramètres",
    href: "/parametres",
    icon: Settings,
    status: "available",
    summary: "Votre page de réservation en ligne et ses règles.",
    planned: [
      "Informations de l'entreprise et logo",
      "Mode d'activité et adresses",
      "Fuseau horaire et durée par défaut",
    ],
    mobilePrimary: false,
  },
];

export function getNavItem(key: string): NavItem {
  const item = navigation.find((i) => i.key === key);
  if (!item) throw new Error(`Module de navigation inconnu : ${key}`);
  return item;
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
