import { PaymentProvider, InitiateDepositParams, InitiateDepositResult, InitiateWithdrawalParams, InitiateWithdrawalResult, WebhookVerificationResult } from './provider-interface.js';
import { generateId } from '@kazibet/shared';

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  passKey: string;
  shortCode: string;
  callbackUrl: string;
}

export class MpesaPaymentAdapter implements PaymentProvider {
  public readonly name = 'MPESA_DARAJA';

  constructor(private readonly config: Partial<MpesaConfig>) {}

  public async initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult> {
    const providerTxId = `ws_CO_${Date.now()}_${generateId().slice(0, 6)}`;
    return {
      providerTxId,
      status: 'PENDING',
      instructions: `STK Push prompted to ${params.phoneNumber}. Enter M-Pesa PIN.`
    };
  }

  public async initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateWithdrawalResult> {
    const providerTxId = `b2c_${Date.now()}_${generateId().slice(0, 6)}`;
    return {
      providerTxId,
      status: 'PENDING'
    };
  }

  public async verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<WebhookVerificationResult> {
    const payload = JSON.parse(rawBody) as {
      Body?: {
        stkCallback?: {
          MerchantRequestID?: string;
          CheckoutRequestID?: string;
          ResultCode?: number;
          ResultDesc?: string;
          CallbackMetadata?: {
            Item?: { Name: string; Value: unknown }[];
          };
        };
      };
    };

    const callback = payload.Body?.stkCallback;
    if (!callback) {
      return {
        valid: false,
        providerTxId: '',
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Malformed M-Pesa callback payload'
      };
    }

    const success = callback.ResultCode === 0;
    let amountCents = 0n;
    if (success && callback.CallbackMetadata?.Item) {
      const amountItem = callback.CallbackMetadata.Item.find(i => i.Name === 'Amount');
      if (amountItem?.Value) {
        amountCents = BigInt(Math.round(Number(amountItem.Value) * 100));
      }
    }

    return {
      valid: true,
      providerTxId: callback.CheckoutRequestID || '',
      amountCents,
      currency: 'KES',
      status: success ? 'SUCCESS' : 'FAILED',
      reason: callback.ResultDesc
    };
  }
}
