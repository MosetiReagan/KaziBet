export type UUID = string;

export type TenantId = string;
export type UserId = string;
export type WalletId = string;
export type BetId = string;
export type EventId = string;
export type MarketId = string;
export type SelectionId = string;

export type CapabilityStatus = 
  | 'SANDBOX'
  | 'PRODUCTION_PENDING'
  | 'PRODUCTION_APPROVED'
  | 'PRODUCTION_ACTIVE'
  | 'SUSPENDED';

export type UserStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'KYC_PENDING'
  | 'KYC_VERIFIED'
  | 'KYC_REJECTED'
  | 'SUSPENDED'
  | 'SELF_EXCLUDED'
  | 'CLOSED';

export type Currency = 'KES' | 'USD' | 'EUR' | 'GBP' | 'UGX' | 'TZS' | 'NGN' | 'GHS';

export type LedgerDirection = 'DR' | 'CR';

export type LedgerAccountType = 
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE';

export type SportSlug = 'football' | 'basketball' | 'tennis' | 'cricket' | 'rugby';

export type EventStatus = 
  | 'SCHEDULED'
  | 'LIVE'
  | 'SUSPENDED'
  | 'FINISHED'
  | 'CANCELLED'
  | 'POSTPONED'
  | 'ABANDONED';

export type MarketStatus = 'ACTIVE' | 'SUSPENDED' | 'SETTLED' | 'VOIDED';

export type SelectionStatus = 'ACTIVE' | 'SUSPENDED' | 'WON' | 'LOST' | 'VOID' | 'HALF_WON' | 'HALF_LOST';

export type BetType = 'SINGLE' | 'ACCUMULATOR' | 'SYSTEM';

export type BetStatus = 
  | 'PLACED'
  | 'WON'
  | 'LOST'
  | 'VOIDED'
  | 'HALF_WON'
  | 'HALF_LOST'
  | 'CASHED_OUT';

export type PaymentStatus = 
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED'
  | 'REFUNDED';

export type RiskAction = 'ALLOW' | 'REVIEW' | 'LIMIT' | 'BLOCK' | 'SUSPEND';

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
