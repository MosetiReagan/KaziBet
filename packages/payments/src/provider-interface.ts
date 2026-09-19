import { TenantId, UserId, Currency, PaymentStatus } from '@kazibet/shared';

export interface InitiateDepositParams {
  tenantId: TenantId;
  userId: UserId;
  amountCents: bigint;
  currency: Currency;
  phoneNumber?: string;
  idempotencyKey: string;
}

export interface InitiateDepositResult {
  providerTxId: string;
  status: PaymentStatus;
  checkoutUrl?: string;
  instructions?: string;
}

export interface InitiateWithdrawalParams {
  tenantId: TenantId;
  userId: UserId;
  amountCents: bigint;
  currency: Currency;
  destinationAccount: string; // e.g. Phone number or Bank IBAN
  idempotencyKey: string;
}

export interface InitiateWithdrawalResult {
  providerTxId: string;
  status: PaymentStatus;
}

export interface WebhookVerificationResult {
  valid: boolean;
  providerTxId: string;
  amountCents: bigint;
  currency: Currency;
  status: PaymentStatus;
  idempotencyKey?: string;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult>;
  initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateWithdrawalResult>;
  verifyWebhook(headers: Record<string, string>, rawBody: string, secret?: string): Promise<WebhookVerificationResult>;
}
