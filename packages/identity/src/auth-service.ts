import {
  generateId,
  TenantId,
  UserId,
  UserStatus,
  KaziBetError
} from '@kazibet/shared';
import { DatabaseTransactionContext, UserEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { CryptoUtil } from './crypto.js';
import { RbacEvaluator, PermissionCode } from './rbac.js';

export interface RegisterUserParams {
  tenantId: TenantId;
  phoneNumber?: string;
  email?: string;
  password: string;
  roles?: string[];
}

export interface LoginResult {
  token: string;
  user: {
    id: UserId;
    tenantId: TenantId;
    email?: string;
    phoneNumber?: string;
    status: UserStatus;
    roles: string[];
    permissions: string[];
  };
}

export class AuthService {
  constructor(
    private readonly getContext: () => DatabaseTransactionContext,
    private readonly jwtSecret: string
  ) {}

  public async register(params: RegisterUserParams): Promise<UserEntity> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.getContext();

    if (!params.phoneNumber && !params.email) {
      throw new KaziBetError('VALIDATION_FAILED', 'Either phone number or email must be provided.');
    }

    if (params.email) {
      const existingEmail = await ctx.users.findFirst(params.tenantId, { email: params.email.toLowerCase() });
      if (existingEmail) {
        throw new KaziBetError('VALIDATION_FAILED', 'A user with this email already exists in this sportsbook.');
      }
    }

    if (params.phoneNumber) {
      const existingPhone = await ctx.users.findFirst(params.tenantId, { phoneNumber: params.phoneNumber });
      if (existingPhone) {
        throw new KaziBetError('VALIDATION_FAILED', 'A user with this phone number already exists in this sportsbook.');
      }
    }

    const userId = generateId();
    const passwordHash = CryptoUtil.hashPassword(params.password);

    const user: UserEntity = {
      id: userId,
      tenantId: params.tenantId,
      email: params.email?.toLowerCase(),
      phoneNumber: params.phoneNumber,
      passwordHash,
      status: 'ACTIVE',
      kycTier: 1,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await ctx.users.create(params.tenantId, user);
  }

  public async login(params: {
    tenantId: TenantId;
    identifier: string; // email or phone
    password: string;
    roles?: string[];
  }): Promise<LoginResult> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.getContext();
    const idClean = params.identifier.trim().toLowerCase();

    const byEmail = await ctx.users.findFirst(params.tenantId, { email: idClean });
    const byPhone = byEmail ? null : await ctx.users.findFirst(params.tenantId, { phoneNumber: params.identifier.trim() });
    const user = byEmail || byPhone;

    if (!user) {
      throw new KaziBetError('UNAUTHORIZED', 'Invalid credentials.', 401);
    }

    const passwordValid = CryptoUtil.verifyPassword(params.password, user.passwordHash);
    if (!passwordValid) {
      throw new KaziBetError('UNAUTHORIZED', 'Invalid credentials.', 401);
    }

    // Check account status restrictions
    if (user.status === 'SUSPENDED') {
      throw new KaziBetError('ACCOUNT_SUSPENDED', 'Your account has been suspended by administration.', 403);
    }
    if (user.status === 'SELF_EXCLUDED') {
      throw new KaziBetError('SELF_EXCLUDED', 'Access blocked: this account is currently under self-exclusion.', 403);
    }
    if (user.status === 'CLOSED') {
      throw new KaziBetError('FORBIDDEN', 'This account is closed.', 403);
    }

    const roles = params.roles && params.roles.length > 0 ? params.roles : ['PLAYER'];
    const permissions = RbacEvaluator.getPermissionsForRoles(roles);

    const token = CryptoUtil.createJwt(
      {
        userId: user.id,
        tenantId: user.tenantId,
        roles,
        permissions
      },
      this.jwtSecret
    );

    return {
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        roles,
        permissions
      }
    };
  }

  public async selfExcludeUser(tenantId: TenantId, userId: UserId, reason: string): Promise<UserEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const user = await ctx.users.findById(tenantId, userId);
    if (!user) {
      throw new KaziBetError('NOT_FOUND', `User ${userId} not found.`);
    }

    const updated = await ctx.users.update(tenantId, userId, {
      status: 'SELF_EXCLUDED',
      updatedAt: new Date()
    });

    // Record audit log
    await ctx.auditLogs.create(tenantId, {
      id: generateId(),
      tenantId,
      actorId: userId,
      actorType: 'USER',
      action: 'USER_SELF_EXCLUDED',
      resourceType: 'USER',
      resourceId: userId,
      beforeState: { status: user.status },
      afterState: { status: 'SELF_EXCLUDED', reason },
      createdAt: new Date()
    });

    return updated;
  }

  public verifyToken(token: string): {
    userId: UserId;
    tenantId: TenantId;
    roles: string[];
    permissions: PermissionCode[];
  } {
    const payload = CryptoUtil.verifyJwt(token, this.jwtSecret);
    return payload as unknown as {
      userId: UserId;
      tenantId: TenantId;
      roles: string[];
      permissions: PermissionCode[];
    };
  }
}
