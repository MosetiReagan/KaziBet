import {
  UUID,
  TenantId,
  UserId,
  WalletId,
  BetId,
  EventId,
  MarketId,
  SelectionId,
  CapabilityStatus,
  UserStatus,
  Currency,
  EventStatus,
  MarketStatus,
  SelectionStatus,
  BetType,
  BetStatus,
  LedgerAccountType,
  LedgerDirection,
  PaymentStatus
} from '@kazibet/shared';

export interface TenantEntity {
  id: TenantId;
  code: string;
  name: string;
  domain: string;
  defaultCurrency: Currency;
  capabilityStatus: CapabilityStatus;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserEntity {
  id: UserId;
  tenantId: TenantId;
  phoneNumber?: string;
  email?: string;
  passwordHash: string;
  status: UserStatus;
  kycTier: number;
  mfaEnabled: boolean;
  mfaSecret?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleEntity {
  id: UUID;
  tenantId?: TenantId;
  name: string;
  description?: string;
  createdAt: Date;
}

export interface PermissionEntity {
  id: UUID;
  code: string;
  description?: string;
}

export interface SportEntity {
  id: UUID;
  slug: string;
  name: string;
  isActive: boolean;
}

export interface CompetitionEntity {
  id: UUID;
  sportId: UUID;
  slug: string;
  name: string;
  country?: string;
}

export interface TeamEntity {
  id: UUID;
  sportId: UUID;
  name: string;
  shortName?: string;
  country?: string;
}

export interface EventEntity {
  id: EventId;
  tenantId: TenantId;
  competitionId: UUID;
  homeTeamId: UUID;
  awayTeamId: UUID;
  scheduledStart: Date;
  actualStart?: Date;
  status: EventStatus;
  homeScore: number;
  awayScore: number;
  period?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketEntity {
  id: MarketId;
  tenantId: TenantId;
  eventId: EventId;
  marketType: string;
  name: string;
  status: MarketStatus;
  suspensionReason?: string;
  parameters: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SelectionEntity {
  id: SelectionId;
  marketId: MarketId;
  name: string;
  currentOdds: number;
  probability?: number;
  version: number;
  status: SelectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletEntity {
  id: WalletId;
  tenantId: TenantId;
  userId: UserId;
  currency: Currency;
  availableCents: bigint;
  heldCents: bigint;
  bonusCents: bigint;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletHoldEntity {
  id: UUID;
  tenantId: TenantId;
  walletId: WalletId;
  betId: BetId;
  amountCents: bigint;
  status: 'ACTIVE' | 'COMMITTED' | 'RELEASED';
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerAccountEntity {
  id: UUID;
  tenantId: TenantId;
  code: string;
  type: LedgerAccountType;
  walletId?: WalletId;
  currency: Currency;
  createdAt: Date;
}

export interface LedgerTransactionEntity {
  id: UUID;
  tenantId: TenantId;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  description?: string;
  postedAt: Date;
}

export interface LedgerEntryEntity {
  id: UUID;
  tenantId: TenantId;
  transactionId: UUID;
  accountId: UUID;
  direction: LedgerDirection;
  amountCents: bigint;
  currency: Currency;
  createdAt: Date;
}

export interface BetSlipEntity {
  id: UUID;
  tenantId: TenantId;
  userId: UserId;
  type: BetType;
  totalStakeCents: bigint;
  potentialPayoutCents: bigint;
  status: BetStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BetEntity {
  id: BetId;
  tenantId: TenantId;
  betSlipId: UUID;
  userId: UserId;
  stakeCents: bigint;
  odds: number;
  potentialPayoutCents: bigint;
  payoutCents: bigint;
  status: BetStatus;
  settledAt?: Date;
  createdAt: Date;
}

export interface BetLegEntity {
  id: UUID;
  betId: BetId;
  eventId: EventId;
  marketId: MarketId;
  selectionId: SelectionId;
  acceptedOdds: number;
  oddsVersion: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'VOID' | 'HALF_WON' | 'HALF_LOST';
}

export interface PaymentEntity {
  id: UUID;
  tenantId: TenantId;
  userId: UserId;
  provider: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amountCents: bigint;
  currency: Currency;
  status: PaymentStatus;
  providerTxId?: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskCaseEntity {
  id: UUID;
  tenantId: TenantId;
  userId: UserId;
  signalType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  score: number;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
  explanation?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogEntity {
  id: UUID;
  tenantId: TenantId;
  actorId?: string;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'API_KEY';
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  createdAt: Date;
}

export interface OutboxEventEntity {
  id: UUID;
  tenantId: TenantId;
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  retryCount: number;
  createdAt: Date;
  publishedAt?: Date;
}
