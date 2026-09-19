import { CapabilityStatus } from '@kazibet/shared';

export interface AppEnv {
  KAZIBET_ENVIRONMENT: CapabilityStatus;
  DATABASE_URL: string;
  REDIS_URL: string;
  KAFKA_BROKERS: string[];
  JWT_SECRET: string;
  JWT_EXPIRATION: string;
  API_PORT: number;
  REALTIME_PORT: number;
  AI_PORT: number;
  DEFAULT_TENANT_CODE: string;
  DEFAULT_CURRENCY: string;
  SIMULATOR_TICK_INTERVAL_MS: number;
  MOCK_PAYMENTS_AUTO_SETTLE: boolean;
}

export function loadEnv(): AppEnv {
  const envMode = (process.env['KAZIBET_ENVIRONMENT'] as CapabilityStatus) || 'SANDBOX';
  const jwtSecret = process.env['JWT_SECRET'];

  if (envMode !== 'SANDBOX') {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        'Fatal configuration error: JWT_SECRET environment variable is missing or shorter than 32 characters outside SANDBOX.'
      );
    }
  }

  const effectiveJwtSecret = jwtSecret || (envMode === 'SANDBOX' ? 'sandbox-default-jwt-secret-min-32-chars-ok!' : '');

  return {
    KAZIBET_ENVIRONMENT: envMode,
    DATABASE_URL: process.env['DATABASE_URL'] || 'postgresql://kazibet_admin:kazibet_secret@localhost:5432/kazibet_db?schema=public',
    REDIS_URL: process.env['REDIS_URL'] || 'redis://localhost:6379',
    KAFKA_BROKERS: (process.env['KAFKA_BROKERS'] || 'localhost:9092').split(','),
    JWT_SECRET: effectiveJwtSecret,
    JWT_EXPIRATION: process.env['JWT_EXPIRATION'] || '15m',
    API_PORT: Number(process.env['API_PORT'] || 4000),
    REALTIME_PORT: Number(process.env['REALTIME_PORT'] || 4001),
    AI_PORT: Number(process.env['AI_PORT'] || 4002),
    DEFAULT_TENANT_CODE: process.env['DEFAULT_TENANT_CODE'] || 'kazi-sports',
    DEFAULT_CURRENCY: process.env['DEFAULT_CURRENCY'] || 'KES',
    SIMULATOR_TICK_INTERVAL_MS: Number(process.env['SIMULATOR_TICK_INTERVAL_MS'] || 3000),
    MOCK_PAYMENTS_AUTO_SETTLE: process.env['MOCK_PAYMENTS_AUTO_SETTLE'] !== 'false'
  };
}
