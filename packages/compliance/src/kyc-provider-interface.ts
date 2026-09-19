import { UserStatus } from '@kazibet/shared';

export interface KycDocumentInput {
  documentType: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE';
  documentNumber: string;
  country: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
}

export interface KycVerificationResult {
  status: 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW';
  tier: number;
  confidenceScore: number;
  failureReasons?: string[];
}

export interface AmlScreeningResult {
  isPep: boolean; // Politically Exposed Person
  isSanctioned: boolean;
  riskScore: number; // 0.0 - 1.0
  matchedLists?: string[];
}

export interface KycProvider {
  readonly name: string;
  verifyDocument(input: KycDocumentInput, mpesaRegisteredName?: string): Promise<KycVerificationResult>;
  screenAml(fullName: string, country: string): Promise<AmlScreeningResult>;
}
