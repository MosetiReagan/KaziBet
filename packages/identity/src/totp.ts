import { createHmac, randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

export interface TotpSetupResult {
  secret: string;
  uri: string;
  backupCodes: string[];
  hashedBackupCodes: string[];
}

export class TotpService {
  private static readonly BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  private static readonly STEP_SECONDS = 30;
  private static readonly CODE_DIGITS = 6;

  /**
   * Generates a new 160-bit (20-byte) base32 TOTP secret and 8 single-use backup codes.
   */
  public static generateSecret(accountName: string, issuer = 'KaziBet'): TotpSetupResult {
    const rawBytes = randomBytes(20);
    const secret = this.base32Encode(rawBytes);

    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
      accountName
    )}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    // Generate 8 backup codes of 8 alphanumeric characters
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];

    for (let i = 0; i < 8; i++) {
      const code = randomBytes(4).toString('hex').toUpperCase(); // 8 hex characters
      backupCodes.push(code);
      hashedBackupCodes.push(this.hashBackupCode(code));
    }

    return {
      secret,
      uri,
      backupCodes,
      hashedBackupCodes
    };
  }

  /**
   * Verifies a 6-digit TOTP token against a base32 secret with step window tolerance (default +- 1 step = +- 30s).
   */
  public static verifyToken(
    secret: string,
    token: string,
    windowSteps = 1,
    currentTimestampMs = Date.now()
  ): boolean {
    const cleanToken = token.trim();
    if (!/^\d{6}$/.test(cleanToken)) {
      return false;
    }

    const currentStep = Math.floor(currentTimestampMs / 1000 / this.STEP_SECONDS);

    for (let stepOffset = -windowSteps; stepOffset <= windowSteps; stepOffset++) {
      const step = currentStep + stepOffset;
      const expectedOtp = this.generateOtpForStep(secret, step);
      if (expectedOtp === cleanToken) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates a 6-digit OTP for a specific time step.
   */
  public static generateOtpForStep(secret: string, step: number): string {
    const key = this.base32Decode(secret);

    // 8-byte big-endian counter buffer
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(step));

    const hmac = createHmac('sha1', key).update(counterBuffer).digest();

    // Dynamic truncation
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const binary =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);

    const otp = binary % Math.pow(10, this.CODE_DIGITS);
    return otp.toString().padStart(this.CODE_DIGITS, '0');
  }

  /**
   * Hashes a backup code with SHA-256 for secure storage.
   */
  public static hashBackupCode(code: string): string {
    return pbkdf2Sync(code.trim().toUpperCase(), 'kazibet_backup_salt', 10000, 32, 'sha256').toString('hex');
  }

  /**
   * Verifies and consumes a single-use backup code.
   * If valid, returns the remaining unconsumed hashed backup codes.
   */
  public static verifyAndConsumeBackupCode(
    providedCode: string,
    hashedBackupCodes: string[]
  ): { valid: boolean; remainingHashedCodes: string[] } {
    const targetHash = this.hashBackupCode(providedCode);

    const matchedIndex = hashedBackupCodes.findIndex(h => {
      try {
        return timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(targetHash, 'hex'));
      } catch {
        return false;
      }
    });

    if (matchedIndex >= 0) {
      const remaining = [...hashedBackupCodes];
      remaining.splice(matchedIndex, 1);
      return { valid: true, remainingHashedCodes: remaining };
    }

    return { valid: false, remainingHashedCodes: hashedBackupCodes };
  }

  /**
   * Base32 encoding RFC 4648.
   */
  private static base32Encode(buffer: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i]!;
      bits += 8;

      while (bits >= 5) {
        output += this.BASE32_CHARS[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += this.BASE32_CHARS[(value << (5 - bits)) & 31];
    }

    return output;
  }

  /**
   * Base32 decoding RFC 4648.
   */
  private static base32Decode(base32: string): Buffer {
    const clean = base32.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (let i = 0; i < clean.length; i++) {
      const idx = this.BASE32_CHARS.indexOf(clean[i]!);
      if (idx === -1) {
        throw new Error(`Invalid base32 character: ${clean[i]}`);
      }

      value = (value << 5) | idx;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }
}
