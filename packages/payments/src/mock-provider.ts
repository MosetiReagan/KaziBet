import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateId } from '@kazibet/shared';
import {
  PaymentProvider,
  InitiateDepositParams,
  InitiateDepositResult,
  InitiateWithdrawalParams,
  InitiateWithdrawalResult,
  WebhookVerificationResult
} from './provider-interface.js';

export class MockPaymentProvider implements PaymentProvider {
  public readonly name = 'MOCK_SANDBOX';

  constructor(private readonly sharedSecret = 'mock-webhook-secret-key-123') {}

  public async initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult> {
    const providerTxId = `mock-dep-${generateId().slice(0, 8)}`;
    return {
      providerTxId,
      status: 'PENDING',
      instructions: `Please enter PIN on simulated mobile prompt for ${params.phoneNumber || 'default'}.`
    };
  }

  public async initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateWithdrawalResult> {
    const providerTxId = `mock-wth-${generateId().slice(0, 8)}`;
    return {
      providerTxId,
      status: 'SUCCESS'
    };
  }

  public async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret?: string
  ): Promise<WebhookVerificationResult> {
    const signature = headers['x-signature'] || headers['x-mock-signature'];
    const activeSecret = secret || this.sharedSecret;

    if (!signature) {
      return {
        valid: false,
        providerTxId: '',
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Missing webhook signature header'
      };
    }

    const expected = createHmac('sha256', activeSecret).update(rawBody).digest('hex');
    const signatureValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!signatureValid) {
      return {
        valid: false,
        providerTxId: '',
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Invalid webhook signature'
      };
    }

    const parsed = JSON.parse(rawBody) as {
      providerTxId: string;
      amountCents: string | number;
      currency: string;
      status: 'SUCCESS' | 'FAILED';
      idempotencyKey?: string;
    };

    return {
      valid: true,
      providerTxId: parsed.providerTxId,
      amountCents: BigInt(parsed.amountCents),
      currency: parsed.currency as 'KES',
      status: parsed.status,
      idempotencyKey: parsed.idempotencyKey
    };
  }

  public generateSimulatedWebhookPayload(data: {
    providerTxId: string;
    amountCents: bigint;
    currency: string;
    status: 'SUCCESS' | 'FAILED';
    idempotencyKey?: string;
  }): { body: string; headers: Record<string, string> } {
    const bodyObj = {
      ...data,
      amountCents: data.amountCents.toString()
    };
    const rawBody = JSON.stringify(bodyObj);
    const signature = createHmac('sha256', this.sharedSecret).update(rawBody).digest('hex');

    return {
      body: rawBody,
      headers: {
        'x-signature': signature,
        'content-type': 'application/json'
      }
    };
  }
}
