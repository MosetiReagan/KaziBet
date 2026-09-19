import { pbkdf2Sync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { UserId, TenantId } from '@kazibet/shared';

const ITERATIONS = 100_000;
const KEYLEN = 64;
const DIGEST = 'sha512';

export class CryptoUtil {
  public static hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
    return `${salt}:${hash}`;
  }

  public static verifyPassword(password: string, combinedHash: string): boolean {
    const [salt, originalHash] = combinedHash.split(':');
    if (!salt || !originalHash) return false;

    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
  }

  public static createJwt(payload: {
    userId: UserId;
    tenantId: TenantId;
    roles: string[];
    permissions: string[];
  }, secret: string, expiresInSeconds = 900): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({
        ...payload,
        iat: now,
        exp: now + expiresInSeconds
      })
    ).toString('base64url');

    const signature = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  public static verifyJwt<T = {
    userId: UserId;
    tenantId: TenantId;
    roles: string[];
    permissions: string[];
    exp: number;
    iat: number;
  }>(token: string, secret: string): T {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure');
    }

    const [header, body, signature] = parts;
    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(expectedSig))) {
      throw new Error('Invalid token signature');
    }

    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf-8')) as T;
    const now = Math.floor(Date.now() / 1000);
    const payloadObj = payload as unknown as { exp?: number };
    if (payloadObj && payloadObj.exp && payloadObj.exp < now) {
      throw new Error('Token expired');
    }

    return payload;
  }
}
