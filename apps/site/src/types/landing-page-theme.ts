export interface LPTemaHero {
  title: string;
  subtitle?: string;
  ctaText: string;
  ctaLink: string;
  backgroundImage?: string;
  mobileBackgroundImage?: string;
}

export interface LPTemaProblem {
  title: string;
  description?: string;
  items: string[];
}

export interface LPTemaRights {
  title: string;
  items: {
    title: string;
    description: string;
    iconName?: string;
  }[];
}

export interface LPTemaHowHelp {
  title: string;
  description: string;
  items: string[];
}

export interface LPTemaProcess {
  title: string;
  steps: {
    num: string;
    title: string;
    description: string;
  }[];
}

export interface LPTemaDocuments {
  title: string;
  description?: string;
  items: string[];
}

export interface LPTemaCTA {
  title: string;
  ctaText: string;
  ctaLink: string;
}

export interface LPSpecificThemeContent {
  seo: {
    title: string;
    description: string;
    keywords: string;
  };
  city?: string;
  state?: string;
  hero: LPTemaHero;
  problem: LPTemaProblem;
  rights: LPTemaRights;
  howHelp: LPTemaHowHelp;
  process: LPTemaProcess;
  documents: LPTemaDocuments;
  finalCta: LPTemaCTA;
  footer?: {
    address?: string;
    phones?: string[];
    email?: string;
    social?: {
      instagram?: string;
      facebook?: string;
      linkedin?: string;
    };
  };
}
