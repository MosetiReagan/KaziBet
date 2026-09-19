export interface WhiteLabelBrandConfig {
  siteTitle: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  defaultLocale: string;
  heroBanner: {
    headline: string;
    subheadline: string;
    ctaText: string;
    ctaLink: string;
  };
}

export class CmsThemeResolver {
  public static resolveTheme(tenantConfig?: Record<string, unknown>): WhiteLabelBrandConfig {
    const brand = (tenantConfig?.['brand'] as Record<string, unknown>) || {};
    return {
      siteTitle: (brand['name'] as string) || 'KaziBet Sportsbook',
      logoUrl: (brand['logoUrl'] as string) || '/assets/logo.svg',
      primaryColor: (brand['primaryColor'] as string) || '#006600',
      secondaryColor: (brand['secondaryColor'] as string) || '#BB0000',
      accentColor: (brand['accentColor'] as string) || '#FFB800',
      defaultLocale: (tenantConfig?.['defaultLocale'] as string) || 'en',
      heroBanner: {
        headline: 'Experience Premier Sports Betting',
        subheadline: 'Best odds, instant mobile payouts, and 24/7 live action.',
        ctaText: 'Bet Now',
        ctaLink: '/live'
      }
    };
  }
}
