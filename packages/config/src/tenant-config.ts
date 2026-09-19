import { Currency, CapabilityStatus } from '@kazibet/shared';

export interface BrandConfig {
  name: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  tagline?: string;
}

export interface LocalizationConfig {
  defaultLocale: string; // 'en' | 'sw'
  supportedLocales: string[];
  timezone: string; // e.g. 'Africa/Nairobi'
  currency: Currency;
}

export interface BettingLimitsConfig {
  minStakeCents: bigint;
  maxStakeCents: bigint;
  maxPayoutCents: bigint;
  maxLegsPerAccumulator: number;
}

export interface ResponsibleGamingConfig {
  allowCoolingOff: boolean;
  allowSelfExclusion: boolean;
  maxDailyDepositLimitCents: bigint;
  maxDailyLossLimitCents: bigint;
  defaultRealityCheckIntervalMinutes: number;
}

export interface TaxConfig {
  withholdingTaxPercentage: number; // e.g. 20.0 for Kenya
  taxOnStakePercentage: number; // e.g. 7.5
  exciseDutyPercentage: number;
  taxBeneficiaryName: string; // e.g. 'Kenya Revenue Authority'
}

export interface ProviderCredentials {
  sportsData?: {
    provider: string;
    apiKey?: string;
    endpoint?: string;
  };
  oddsData?: {
    provider: string;
    apiKey?: string;
  };
  paymentGateways?: {
    mpesa?: {
      consumerKey?: string;
      consumerSecret?: string;
      passKey?: string;
      shortCode?: string;
    };
    airtelMoney?: {
      clientId?: string;
      clientSecret?: string;
    };
    stripe?: {
      secretKey?: string;
      webhookSecret?: string;
    };
  };
  kyc?: {
    provider: string;
    apiKey?: string;
  };
}

export interface TenantConfig {
  tenantId: string;
  code: string;
  domain: string;
  capabilityStatus: CapabilityStatus;
  jurisdiction: string; // e.g. 'KE', 'UG', 'TZ', 'MT', 'GB'
  brand: BrandConfig;
  localization: LocalizationConfig;
  limits: BettingLimitsConfig;
  responsibleGaming: ResponsibleGamingConfig;
  tax: TaxConfig;
  providers: ProviderCredentials;
  featureFlags: Record<string, boolean>;
}
