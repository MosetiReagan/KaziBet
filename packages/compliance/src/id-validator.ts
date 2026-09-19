export type DocumentType = 'NATIONAL_ID' | 'ALIEN_ID' | 'PASSPORT' | 'DRIVING_LICENSE';

export interface DocumentValidationResult {
  valid: boolean;
  docType: DocumentType;
  docNumber: string;
  error?: string;
}

/**
 * Validates Kenyan identification document number formats:
 * - National ID: 7 to 8 digits
 * - Alien ID: 9 digits
 * - Passport: 1 letter followed by 7 or 8 digits
 * - Driving License: 7 to 9 alphanumeric characters
 */
export class IdValidator {
  private static readonly NATIONAL_ID_REGEX = /^\d{7,8}$/;
  private static readonly ALIEN_ID_REGEX = /^\d{9}$/;
  private static readonly PASSPORT_REGEX = /^[A-Za-z]\d{7,8}$/;
  private static readonly DRIVING_LICENSE_REGEX = /^[A-Za-z0-9]{7,9}$/;

  public static validate(docType: DocumentType, docNumber: string): DocumentValidationResult {
    const cleaned = docNumber.trim().toUpperCase();

    switch (docType) {
      case 'NATIONAL_ID': {
        const valid = this.NATIONAL_ID_REGEX.test(cleaned);
        return {
          valid,
          docType,
          docNumber: cleaned,
          error: valid ? undefined : 'Kenya National ID must be strictly 7 or 8 digits.'
        };
      }

      case 'ALIEN_ID': {
        const valid = this.ALIEN_ID_REGEX.test(cleaned);
        return {
          valid,
          docType,
          docNumber: cleaned,
          error: valid ? undefined : 'Kenya Alien ID must be strictly 9 digits.'
        };
      }

      case 'PASSPORT': {
        const valid = this.PASSPORT_REGEX.test(cleaned);
        return {
          valid,
          docType,
          docNumber: cleaned,
          error: valid ? undefined : 'Passport number must start with 1 letter followed by 7 or 8 digits (e.g. A1234567).'
        };
      }

      case 'DRIVING_LICENSE': {
        const valid = this.DRIVING_LICENSE_REGEX.test(cleaned);
        return {
          valid,
          docType,
          docNumber: cleaned,
          error: valid ? undefined : 'Driving license must be 7 to 9 alphanumeric characters.'
        };
      }

      default: {
        return {
          valid: false,
          docType,
          docNumber: cleaned,
          error: `Unsupported document type: ${docType}`
        };
      }
    }
  }
}
