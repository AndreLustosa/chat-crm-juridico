export interface LPHero {
  title: string;
  subtitle?: string;
  secondarySubtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  lawyerImage?: string;
  oab?: string;
  backgroundDesktop?: string;
  backgroundMobile?: string;
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
}

export interface LPTemplateContent {
  hero: LPHero;
  steps?: LPStep[];
  faq?: LPFaqItem[];
  footer?: LPFooter;
  practiceAreas?: LPPracticeArea[];
  sectionLabels?: LPSectionLabels;
}
