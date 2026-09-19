import { BetCalculator } from './bet-calculator.js';

export interface CashierBalance {
  currency: string;
  availableCents: bigint;
  heldCents: bigint;
  bonusCents: bigint;
  availableDisplay: string;
  heldDisplay: string;
}

export interface DepositStatusResponse {
  paymentId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  amountCents: bigint;
  currency: string;
}

export class CashierManager {
  /**
   * Format balance response safely into bigint cents and KES display.
   */
  public static parseBalance(data: {
    currency?: string;
    availableCents?: string | number | bigint;
    heldCents?: string | number | bigint;
    bonusCents?: string | number | bigint;
  }): CashierBalance {
    const currency = data.currency || 'KES';
    const availableCents = BigInt(data.availableCents ?? 0);
    const heldCents = BigInt(data.heldCents ?? 0);
    const bonusCents = BigInt(data.bonusCents ?? 0);

    return {
      currency,
      availableCents,
      heldCents,
      bonusCents,
      availableDisplay: BetCalculator.formatCentsToKes(availableCents),
      heldDisplay: BetCalculator.formatCentsToKes(heldCents)
    };
  }

  /**
   * Validate Kenyan phone number format for Daraja M-Pesa.
   * Accepts: +2547XXXXXXXX, 07XXXXXXXX, 2547XXXXXXXX, 01XXXXXXXX
   */
  public static validateKenyanPhone(phone: string): { valid: boolean; normalized: string; error?: string } {
    const cleaned = phone.replace(/[\s\-]/g, '');
    const msisdnRegex = /^(?:\+?254|0)?([17]\d{8})$/;
    const match = cleaned.match(msisdnRegex);
    if (!match) {
      return {
        valid: false,
        normalized: '',
        error: 'Phone number must be a valid Kenyan mobile number (e.g. 0712345678 or +254712345678).'
      };
    }
    return {
      valid: true,
      normalized: `254${match[1]}`
    };
  }
}
