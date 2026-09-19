import { TenantConfig } from './tenant-config.js';

export function createKenyaReferenceConfig(overrides?: Partial<TenantConfig>): TenantConfig {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    code: 'kazi-sports',
    domain: 'kazi.bet.local',
    capabilityStatus: 'SANDBOX',
    jurisdiction: 'KE',
    brand: {
      name: 'KaziBet Sportsbook',
      primaryColor: '#006600', // Kenya green
      secondaryColor: '#BB0000', // Kenya red
      accentColor: '#FFB800',
      tagline: 'The open sportsbook infrastructure platform.'
    },
    localization: {
      defaultLocale: 'en',
      supportedLocales: ['en', 'sw'],
      timezone: 'Africa/Nairobi',
      currency: 'KES'
    },
    limits: {
      minStakeCents: 1000n, // 10.00 KES
      maxStakeCents: 10000000n, // 100,000.00 KES
      maxPayoutCents: 500000000n, // 5,000,000.00 KES
      maxLegsPerAccumulator: 30
    },
    responsibleGaming: {
      allowCoolingOff: true,
      allowSelfExclusion: true,
      maxDailyDepositLimitCents: 50000000n, // 500,000.00 KES
      maxDailyLossLimitCents: 20000000n, // 200,000.00 KES
      defaultRealityCheckIntervalMinutes: 60
    },
    tax: {
      withholdingTaxPercentage: 20.0, // Kenya BCLB 20% on net winnings
      taxOnStakePercentage: 0.0,
      exciseDutyPercentage: 7.5,
      taxBeneficiaryName: 'Kenya Revenue Authority (KRA)'
    },
    providers: {
      sportsData: {
        provider: 'simulator'
      },
      oddsData: {
        provider: 'simulator'
      },
      paymentGateways: {
        mpesa: {
          shortCode: '174379'
        }
      },
      kyc: {
        provider: 'mock'
      }
    },
    featureFlags: {
      cashoutEnabled: true,
      liveBettingEnabled: true,
      promotionsEnabled: true,
      aiCopilotEnabled: true
    },
    ...overrides
  };
}
