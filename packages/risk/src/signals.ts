import { RiskAction, TenantId, UserId } from '@kazibet/shared';

export type SignalType =
  | 'RAPID_BET_VELOCITY'
  | 'DEPOSIT_SPIKE'
  | 'SUSPICIOUS_PAYMENT_REVERSAL'
  | 'MULTIPLE_FAILED_LOGINS'
  | 'DEVICE_FINGERPRINT_MISMATCH'
  | 'MARKET_EXPOSURE_LIMIT_EXCEEDED'
  | 'MULTI_ACCOUNT_DEVICE_SHARING'
  | 'MULTI_ACCOUNT_IP_SHARING'
  | 'MULTI_ACCOUNT_PAYMENT_SHARING';

export interface DetectedSignal {
  type: SignalType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  score: number; // 0.0 - 1.0
  description: string;
  metadata?: Record<string, unknown>;
}

export interface RiskEvaluationResult {
  compositeScore: number;
  recommendedAction: RiskAction;
  signals: DetectedSignal[];
  requiresManualReview: boolean;
}

export interface UserDeviceProfile {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  ipAddress: string;
  deviceFingerprint: string;
  mpesaPhoneName?: string;
  lastSeenAt: Date;
}
