import {
  KycProvider,
  KycDocumentInput,
  KycVerificationResult,
  AmlScreeningResult
} from './kyc-provider-interface.js';

export class MockKycProvider implements KycProvider {
  public readonly name = 'MOCK_KYC';

  public async verifyDocument(input: KycDocumentInput): Promise<KycVerificationResult> {
    // Under 18 check
    const birthYear = new Date(input.dateOfBirth).getFullYear();
    const currentYear = new Date().getFullYear();
    if (currentYear - birthYear < 18) {
      return {
        status: 'REJECTED',
        tier: 0,
        confidenceScore: 0.99,
        failureReasons: ['Underage applicant: Under 18 years of age is strictly prohibited.']
      };
    }

    if (input.documentNumber.startsWith('FAIL')) {
      return {
        status: 'REJECTED',
        tier: 0,
        confidenceScore: 0.85,
        failureReasons: ['Document unreadable or fraudulent']
      };
    }

    return {
      status: 'VERIFIED',
      tier: 2,
      confidenceScore: 0.98
    };
  }

  public async screenAml(fullName: string, _country: string): Promise<AmlScreeningResult> {
    const nameLower = fullName.toLowerCase();
    if (nameLower.includes('sanction') || nameLower.includes('blocked')) {
      return {
        isPep: false,
        isSanctioned: true,
        riskScore: 0.95,
        matchedLists: ['OFAC_SPECIALLY_DESIGNATED_NATIONALS', 'UN_SECURITY_COUNCIL_SANCTIONS']
      };
    }

    if (nameLower.includes('minister') || nameLower.includes('senator')) {
      return {
        isPep: true,
        isSanctioned: false,
        riskScore: 0.45,
        matchedLists: ['NATIONAL_PEP_DATABASE']
      };
    }

    return {
      isPep: false,
      isSanctioned: false,
      riskScore: 0.05
    };
  }
}
