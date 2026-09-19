import { CapabilityRestrictionError } from '@kazibet/shared';
import { TenantConfig } from './tenant-config.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export class CapabilityValidator {
  /**
   * Validates if a tenant configuration complies with all production prerequisites.
   */
  public static validateForProduction(config: TenantConfig): { valid: boolean; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];

    // 1. Operator Domain Verification
    if (!config.domain || config.domain.includes('localhost') || config.domain.endsWith('.local')) {
      issues.push({
        field: 'domain',
        message: 'A fully-qualified production domain (e.g. sports.example.com) is required for production activation.'
      });
    }

    // 2. Jurisdiction & Tax Engine
    if (!config.jurisdiction || config.jurisdiction.trim() === '') {
      issues.push({
        field: 'jurisdiction',
        message: 'A valid ISO country code / jurisdiction must be specified.'
      });
    }

    if (!config.tax || config.tax.withholdingTaxPercentage === undefined || config.tax.withholdingTaxPercentage < 0 || !config.tax.taxBeneficiaryName) {
      issues.push({
        field: 'tax',
        message: 'A compliant tax configuration with beneficiary name is mandatory for production.'
      });
    }

    // 3. KYC / AML Configuration
    if (!config.providers?.kyc?.apiKey || config.providers?.kyc?.provider === 'mock') {
      issues.push({
        field: 'providers.kyc',
        message: 'A certified production KYC/AML provider must be configured.'
      });
    }

    // 4. Live Payment Gateway
    const payment = config.providers?.paymentGateways;
    const hasLivePayment = Boolean(
      (payment?.mpesa?.consumerKey && payment?.mpesa?.consumerSecret) ||
      (payment?.airtelMoney?.clientId && payment?.airtelMoney?.clientSecret) ||
      payment?.stripe?.secretKey
    );

    if (!hasLivePayment) {
      issues.push({
        field: 'providers.paymentGateways',
        message: 'At least one verified production payment gateway must be configured.'
      });
    }

    // 5. Sports & Odds Feed
    if (!config.providers?.sportsData?.apiKey && !config.providers?.oddsData?.apiKey) {
      issues.push({
        field: 'providers.sportsData',
        message: 'Commercial sports data or odds provider credentials must be configured for production.'
      });
    }

    // 6. Responsible Gaming Mandates
    if (!config.responsibleGaming?.allowSelfExclusion || !config.responsibleGaming?.maxDailyDepositLimitCents || config.responsibleGaming.maxDailyDepositLimitCents <= 0n) {
      issues.push({
        field: 'responsibleGaming',
        message: 'Responsible gaming controls (self-exclusion and deposit ceilings) must be enabled.'
      });
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Asserts that a tenant can perform real-money operations.
   * Throws CapabilityRestrictionError if not in PRODUCTION_ACTIVE mode.
   */
  public static assertRealMoneyAllowed(config: TenantConfig): void {
    if (config.capabilityStatus !== 'PRODUCTION_ACTIVE') {
      throw new CapabilityRestrictionError(
        `Real-money transaction rejected. Tenant '${config.code}' is in ${config.capabilityStatus} mode. Only PRODUCTION_ACTIVE tenants can process real funds.`
      );
    }
  }
}
