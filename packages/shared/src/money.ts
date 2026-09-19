import { Currency } from './types.js';

/**
 * Money representation in minor units (e.g. cents) using bigint to eliminate floating point inaccuracies.
 */
export class Money {
  public readonly amountCents: bigint;
  public readonly currency: Currency;

  constructor(amountCents: bigint | number | string, currency: Currency = 'KES') {
    this.amountCents = BigInt(amountCents);
    this.currency = currency;
  }

  public static zero(currency: Currency = 'KES'): Money {
    return new Money(0n, currency);
  }

  public static fromMajor(majorAmount: number | string, currency: Currency = 'KES'): Money {
    const parsed = typeof majorAmount === 'number' ? majorAmount.toFixed(4) : majorAmount;
    const [intPart = '0', decPart = ''] = parsed.split('.');
    const paddedDec = (decPart + '00').slice(0, 2);
    const sign = parsed.startsWith('-') ? -1n : 1n;
    const cleanInt = intPart.replace('-', '');
    const cents = sign * (BigInt(cleanInt) * 100n + BigInt(paddedDec));
    return new Money(cents, currency);
  }

  public toMajor(): number {
    return Number(this.amountCents) / 100;
  }

  public toFormattedString(): string {
    const major = this.toMajor().toFixed(2);
    return `${this.currency} ${major}`;
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents + other.amountCents, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents - other.amountCents, this.currency);
  }

  public multiplyByDecimal(factor: number): Money {
    // Multiply by factor with 4 decimal places of precision, then round
    const factorInt = BigInt(Math.round(factor * 10000));
    const resultCents = (this.amountCents * factorInt + 5000n) / 10000n;
    return new Money(resultCents, this.currency);
  }

  public isZero(): boolean {
    return this.amountCents === 0n;
  }

  public isPositive(): boolean {
    return this.amountCents > 0n;
  }

  public isNegative(): boolean {
    return this.amountCents < 0n;
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountCents > other.amountCents;
  }

  public isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountCents >= other.amountCents;
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountCents < other.amountCents;
  }

  public isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountCents <= other.amountCents;
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.amountCents === other.amountCents;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot operate between ${this.currency} and ${other.currency}`);
    }
  }
}
