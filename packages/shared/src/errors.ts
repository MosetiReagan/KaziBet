export type ErrorCode =
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_FUNDS'
  | 'CONCURRENCY_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MARKET_SUSPENDED'
  | 'ODDS_CHANGED'
  | 'INVALID_SELECTION'
  | 'SELF_EXCLUDED'
  | 'ACCOUNT_SUSPENDED'
  | 'RESPONSIBLE_GAMING_LIMIT_EXCEEDED'
  | 'CAPABILITY_RESTRICTION'
  | 'LEDGER_UNBALANCED'
  | 'PAYMENT_FAILED'
  | 'RECONCILIATION_MISMATCH'
  | 'MFA_REQUIRED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'FORBIDDEN_ORIGIN'
  | 'PAYLOAD_TOO_LARGE';

export interface ErrorResponseFormat {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export class KaziBetError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public requestId?: string;

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'KaziBetError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): ErrorResponseFormat {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.requestId ? { requestId: this.requestId } : {}),
        ...(this.details ? { details: this.details } : {})
      }
    };
  }
}

export class InsufficientFundsError extends KaziBetError {
  constructor(message = 'The wallet does not have sufficient available funds.', details?: Record<string, unknown>) {
    super('INSUFFICIENT_FUNDS', message, 400, details);
  }
}

export class TenantIsolationError extends KaziBetError {
  constructor(message = 'Access denied: cross-tenant operation prohibited.', details?: Record<string, unknown>) {
    super('TENANT_MISMATCH', message, 403, details);
  }
}

export class CapabilityRestrictionError extends KaziBetError {
  constructor(message = 'Real-money operation rejected: tenant capability is not PRODUCTION_ACTIVE.', details?: Record<string, unknown>) {
    super('CAPABILITY_RESTRICTION', message, 403, details);
  }
}

export class MarketSuspendedError extends KaziBetError {
  constructor(marketId: string, message = 'Wager rejected: market is currently suspended.') {
    super('MARKET_SUSPENDED', message, 400, { marketId });
  }
}

export class OddsChangedError extends KaziBetError {
  constructor(selectionId: string, acceptedOdds: number, currentOdds: number) {
    super(
      'ODDS_CHANGED',
      `Odds have changed for selection ${selectionId} from ${acceptedOdds} to ${currentOdds}.`,
      409,
      { selectionId, acceptedOdds, currentOdds }
    );
  }
}

export class ResponsibleGamingViolationError extends KaziBetError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RESPONSIBLE_GAMING_LIMIT_EXCEEDED', message, 403, details);
  }
}

export class LedgerUnbalancedError extends KaziBetError {
  constructor(debitSum: bigint, creditSum: bigint) {
    super(
      'LEDGER_UNBALANCED',
      `Ledger invariant violated: Debits (${debitSum.toString()}) != Credits (${creditSum.toString()}).`,
      500,
      { debitSum: debitSum.toString(), creditSum: creditSum.toString() }
    );
  }
}
