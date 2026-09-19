import {
  generateId,
  TenantId,
  UserId,
  KaziBetError,
  createDomainEvent
} from '@kazibet/shared';
import { DatabaseTransactionContext, IDatabase, UserEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { KycProvider, KycDocumentInput } from './kyc-provider-interface.js';

export class KycService {
  constructor(
    private readonly db: IDatabase,
    private readonly provider: KycProvider
  ) {}

  public async submitVerification(params: {
    tenantId: TenantId;
    userId: UserId;
    document: KycDocumentInput;
    mpesaRegisteredName?: string;
  }): Promise<{ status: string; tier: number; user: UserEntity }> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.db.getContext();

    const user = await ctx.users.findById(params.tenantId, params.userId);
    if (!user) {
      throw new KaziBetError('NOT_FOUND', `User ${params.userId} not found.`);
    }

    // 1. Verify document
    const docRes = await this.provider.verifyDocument(params.document, params.mpesaRegisteredName);

    // 2. Screen AML
    const amlRes = await this.provider.screenAml(params.document.fullName, params.document.country);

    let finalUserStatus = user.status;
    let finalTier = user.kycTier;

    if (amlRes.isSanctioned) {
      finalUserStatus = 'SUSPENDED';
      // Record risk case
      await ctx.riskCases.create(params.tenantId, {
        id: generateId(),
        tenantId: params.tenantId,
        userId: params.userId,
        signalType: 'AML_SANCTIONS_MATCH',
        severity: 'CRITICAL',
        score: 1.0,
        status: 'OPEN',
        explanation: `User matched international sanctions list: ${amlRes.matchedLists?.join(', ')}`,
        metadata: { matchedLists: amlRes.matchedLists },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } else if (docRes.status === 'VERIFIED') {
      finalUserStatus = 'KYC_VERIFIED';
      finalTier = docRes.tier;
    } else if (docRes.status === 'REJECTED') {
      finalUserStatus = 'KYC_REJECTED';
    }

    const updatedUser = await ctx.users.update(params.tenantId, params.userId, {
      status: finalUserStatus,
      kycTier: finalTier,
      updatedAt: new Date()
    });

    // Audit log
    await ctx.auditLogs.create(params.tenantId, {
      id: generateId(),
      tenantId: params.tenantId,
      actorType: 'SYSTEM',
      action: 'KYC_VERIFICATION_PROCESSED',
      resourceType: 'USER',
      resourceId: params.userId,
      beforeState: { status: user.status, kycTier: user.kycTier },
      afterState: { status: finalUserStatus, kycTier: finalTier, reasons: docRes.failureReasons },
      createdAt: new Date()
    });

    return {
      status: docRes.status,
      tier: finalTier,
      user: updatedUser
    };
  }
}
