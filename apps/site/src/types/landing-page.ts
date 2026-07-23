export interface LPHero {
  title: string;
  subtitle?: string;
  mobileSubtitle?: string;
  secondarySubtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  lawyerImage?: string;
  oab?: string;
  backgroundDesktop?: string;
  backgroundMobile?: string;
  /** Posicao do badge "Excelencia e Competencia" no hero (desktop).
   *  "default" (padrao): topo — bom para fotos amplas, como a de /geral/arapiraca.
   *  "low": mais abaixo — para fotos de retrato, onde o topo cai sobre o rosto. */
  badgesPosition?: "default" | "low";
}

export interface LPStep {
  title: string;
  description: string;
}

export interface LPFaqItem {
  question: string;
  answer: string;
}

export interface LPFooter {
  address?: string;
  phones?: string[];
  email?: string;
  /** Responsável técnico + inscrição OAB (ex.: "André Lustosa — OAB/AL 14209"). */
  oab?: string;
  social?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
  };
}

export interface LPPracticeArea {
  iconName: string;
  title: string;
  description: string;
  colSpan2?: boolean;
  href?: string;
  /** Imagem de fundo do card (grade dirigida por conteúdo). Sem ela, usa o padrão. */
  bgImage?: string;
  /** Selo do card (ex.: "PREVIDENCIÁRIO"). Sem ele, usa "ESPECIALIDADE". */
  tag?: string;
}

export interface LPSectionLabels {
  servicesTag?: string;
  servicesTitle?: string;
  servicesDescription?: string;
  bannerTitle?: string;
  officeTag?: string;
  officeTitle?: string;
  officeDescription?: string;
  excellenceTitle?: string;
  /** Quick Answer (SEO/AEO) — resposta direta exibida logo após o hero. */
  quickAnswer?: string;
}

export interface LPTemplateContent {
  hero: LPHero;
  steps?: LPStep[];
  faq?: LPFaqItem[];
  footer?: LPFooter;
  practiceAreas?: LPPracticeArea[];
  sectionLabels?: LPSectionLabels;
}
