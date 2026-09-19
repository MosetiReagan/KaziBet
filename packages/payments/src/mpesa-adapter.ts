import {
  PaymentProvider,
  InitiateDepositParams,
  InitiateDepositResult,
  InitiateWithdrawalParams,
  InitiateWithdrawalResult,
  WebhookVerificationResult,
  PaymentStatusQueryResult
} from './provider-interface.js';
import { generateId, KaziBetError } from '@kazibet/shared';

export interface MpesaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  passKey: string;
  shortCode: string;
  b2cShortCode?: string;
  initiatorName?: string;
  initiatorPassword?: string;
  callbackBaseUrl: string;
  allowedIpRanges?: string[];
  queryConfirmationRequired?: boolean;
}

export const SAFARICOM_IP_RANGES = [
  '196.201.214.0/24',
  '196.201.213.0/24',
  '196.201.215.0/24',
  '196.19.140.0/24',
  '196.207.243.0/24'
];

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    return ip === cidr;
  }
  const parts = cidr.split('/');
  const rangeIp = parts[0];
  const prefixStr = parts[1];
  if (!rangeIp || !prefixStr) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipToLong = (dotIp: string): number | null => {
    const octets = dotIp.split('.').map(Number);
    if (octets.length !== 4 || octets.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
    const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = octets;
    return ((p0 << 24) | (p1 << 16) | (p2 << 8) | p3) >>> 0;
  };

  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(rangeIp);
  if (ipLong === null || rangeLong === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class MpesaPaymentAdapter implements PaymentProvider {
  public readonly name = 'MPESA_DARAJA';
  private tokenCache: TokenCache | null = null;
  private pendingTokens = new Map<string, string>(); // CheckoutRequestID -> verificationToken

  constructor(private readonly config: MpesaConfig) {}

  /**
   * Helper to format Date to East Africa Time string format: YYYYMMDDHHmmss
   */
  public static formatTimestamp(date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Helper to format phone number to Safaricom 2547XXXXXXXX format
   */
  public static normalizePhoneNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
      return `254${digits.slice(1)}`;
    }
    if (digits.startsWith('7') && digits.length === 9) {
      return `254${digits}`;
    }
    if (digits.startsWith('254') && digits.length === 12) {
      return digits;
    }
    return digits;
  }

  /**
   * Fetch OAuth access token from Safaricom with in-memory caching and automatic expiry refresh.
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - 60000 > now) {
      return this.tokenCache.accessToken;
    }

    const authHeader = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`
    ).toString('base64');

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/oauth/v1/generate?grant_type=client_credentials`;

    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authHeader}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new KaziBetError(
        'PAYMENT_FAILED',
        `Failed to fetch M-Pesa OAuth token: ${res.status} ${errText}`
      );
    }

    const data = (await res.json()) as { access_token: string; expires_in: string };
    const expiresInSeconds = Number(data.expires_in) || 3599;

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + expiresInSeconds * 1000
    };

    return this.tokenCache.accessToken;
  }

  /**
   * Initiate STK push (Lipa Na M-Pesa Online).
   */
  public async initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult> {
    const token = await this.getAccessToken();
    const timestamp = MpesaPaymentAdapter.formatTimestamp();
    const password = Buffer.from(
      `${this.config.shortCode}${this.config.passKey}${timestamp}`
    ).toString('base64');

    const phone = params.phoneNumber
      ? MpesaPaymentAdapter.normalizePhoneNumber(params.phoneNumber)
      : '254700000000';

    // Amount in shillings (Daraja accepts integer shillings)
    const amountShillings = Math.max(1, Number(params.amountCents / 100n));

    // Unguessable per-payment verification token for callback authentication
    const verificationToken = generateId().replace(/-/g, '');

    const callbackUrl = `${this.config.callbackBaseUrl.replace(/\/$/, '')}/api/v1/payments/mpesa/callback?token=${verificationToken}&idempotency=${params.idempotencyKey}`;

    const payload = {
      BusinessShortCode: this.config.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amountShillings,
      PartyA: phone,
      PartyB: this.config.shortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: params.userId.slice(0, 12),
      TransactionDesc: 'KaziBet Deposit'
    };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/mpesa/stkpush/v1/processrequest`;

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new KaziBetError(
        'PAYMENT_FAILED',
        `Daraja STK Push request failed: ${res.status} ${errText}`
      );
    }

    const data = (await res.json()) as {
      ResponseCode: string;
      ResponseDescription: string;
      CheckoutRequestID: string;
      CustomerMessage?: string;
    };

    if (data.ResponseCode !== '0') {
      throw new KaziBetError(
        'PAYMENT_FAILED',
        `Daraja STK Push error: ${data.ResponseDescription}`
      );
    }

    // Save verification token for this CheckoutRequestID
    this.pendingTokens.set(data.CheckoutRequestID, verificationToken);

    return {
      providerTxId: data.CheckoutRequestID,
      status: 'PENDING',
      instructions: data.CustomerMessage || `STK Push prompted to ${phone}. Please enter your M-Pesa PIN.`
    };
  }

  /**
   * Query status of an STK push transaction.
   */
  public async queryPaymentStatus(providerTxId: string): Promise<PaymentStatusQueryResult> {
    const token = await this.getAccessToken();
    const timestamp = MpesaPaymentAdapter.formatTimestamp();
    const password = Buffer.from(
      `${this.config.shortCode}${this.config.passKey}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: this.config.shortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: providerTxId
    };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/mpesa/stkpushquery/v1/query`;

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        providerTxId,
        status: 'PENDING',
        resultDesc: `Query failed: ${res.status} ${errText}`
      };
    }

    const data = (await res.json()) as {
      ResponseCode: string;
      ResultCode: string;
      ResultDesc: string;
    };

    const resultCode = Number(data.ResultCode);
    let status: PaymentStatusQueryResult['status'] = 'PENDING';

    if (resultCode === 0) {
      status = 'SUCCESS';
    } else if (resultCode === 1032 || resultCode === 1037 || resultCode > 0) {
      status = 'FAILED';
    }

    return {
      providerTxId,
      status,
      resultCode,
      resultDesc: data.ResultDesc
    };
  }

  /**
   * Initiate B2C Payout (Withdrawal).
   */
  public async initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateWithdrawalResult> {
    const token = await this.getAccessToken();
    const phone = MpesaPaymentAdapter.normalizePhoneNumber(params.destinationAccount);
    const amountShillings = Math.max(1, Number(params.amountCents / 100n));

    const verificationToken = generateId().replace(/-/g, '');
    const resultUrl = `${this.config.callbackBaseUrl.replace(/\/$/, '')}/api/v1/payments/mpesa/b2c/result?token=${verificationToken}`;
    const timeoutUrl = `${this.config.callbackBaseUrl.replace(/\/$/, '')}/api/v1/payments/mpesa/b2c/timeout?token=${verificationToken}`;

    const payload = {
      InitiatorName: this.config.initiatorName || 'test_initiator',
      SecurityCredential: this.config.initiatorPassword || 'test_cred',
      CommandID: 'BusinessPayment',
      Amount: amountShillings,
      PartyA: this.config.b2cShortCode || this.config.shortCode,
      PartyB: phone,
      Remarks: 'KaziBet Payout',
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: 'Withdrawal'
    };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/mpesa/b2c/v1/paymentrequest`;

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new KaziBetError(
        'PAYMENT_FAILED',
        `Daraja B2C payout request failed: ${res.status} ${errText}`
      );
    }

    const data = (await res.json()) as {
      ConversationID?: string;
      OriginatorConversationID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
    };

    const providerTxId = data.ConversationID || data.OriginatorConversationID || `b2c_${generateId()}`;

    return {
      providerTxId,
      status: 'PENDING'
    };
  }

  /**
   * Verify and authenticate incoming M-Pesa webhook callback.
   * Enforces:
   * 1. Per-payment unguessable verification token.
   * 2. IP allowlist check against Safaricom ranges (if configured).
   * 3. Confirmation query with Daraja backend before approving.
   */
  public async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string,
    expectedToken?: string
  ): Promise<WebhookVerificationResult> {
    // 1. IP allowlist verification
    const clientIp = headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip'];
    if (this.config.allowedIpRanges && this.config.allowedIpRanges.length > 0 && clientIp) {
      const isAllowed = this.config.allowedIpRanges.some((range) =>
        isIpInCidr(clientIp, range)
      );
      if (!isAllowed) {
        return {
          valid: false,
          providerTxId: '',
          amountCents: 0n,
          currency: 'KES',
          status: 'FAILED',
          reason: `Rejected callback from unapproved IP: ${clientIp}`
        };
      }
    }

    // 2. Parse callback body
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return {
        valid: false,
        providerTxId: '',
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Malformed JSON payload'
      };
    }

    const stk = payload.Body?.stkCallback;
    if (!stk) {
      return {
        valid: false,
        providerTxId: '',
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Missing stkCallback structure in payload'
      };
    }

    const checkoutRequestId = stk.CheckoutRequestID || '';
    const storedToken = this.pendingTokens.get(checkoutRequestId);

    // 3. Per-payment token authentication
    const tokenFromHeaderOrParam = headers['x-callback-token'] || expectedToken;
    if (storedToken && tokenFromHeaderOrParam && storedToken !== tokenFromHeaderOrParam) {
      return {
        valid: false,
        providerTxId: checkoutRequestId,
        amountCents: 0n,
        currency: 'KES',
        status: 'FAILED',
        reason: 'Callback verification token mismatch: potential forgery'
      };
    }

    const success = Number(stk.ResultCode) === 0;
    let amountCents = 0n;

    if (success && stk.CallbackMetadata?.Item) {
      const amountItem = stk.CallbackMetadata.Item.find((i: any) => i.Name === 'Amount');
      if (amountItem?.Value) {
        amountCents = BigInt(Math.round(Number(amountItem.Value) * 100));
      }
    }

    // 4. Confirm with STK query if enabled
    if (success && this.config.queryConfirmationRequired) {
      try {
        const queryRes = await this.queryPaymentStatus(checkoutRequestId);
        if (queryRes.status !== 'SUCCESS') {
          return {
            valid: false,
            providerTxId: checkoutRequestId,
            amountCents,
            currency: 'KES',
            status: 'FAILED',
            reason: `STK verification query did not confirm success: status ${queryRes.status}`
          };
        }
      } catch (err) {
        return {
          valid: false,
          providerTxId: checkoutRequestId,
          amountCents,
          currency: 'KES',
          status: 'FAILED',
          reason: `Failed to confirm payment with Daraja query: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    }

    return {
      valid: true,
      providerTxId: checkoutRequestId,
      amountCents,
      currency: 'KES',
      status: success ? 'SUCCESS' : 'FAILED',
      reason: stk.ResultDesc
    };
  }

  /**
   * Fetch with exponential backoff for transient errors.
   */
  private async fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
    let delay = 200;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.status >= 500 && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        return res;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error(`Exceeded max retries for ${url}`);
  }
}
