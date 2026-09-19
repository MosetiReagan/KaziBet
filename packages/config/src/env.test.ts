import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './env.js';

describe('Environment Configuration Loader', () => {
  const originalEnv = { ...process.env };

  test('loads default configuration in SANDBOX mode with fallback secret', () => {
    delete process.env['KAZIBET_ENVIRONMENT'];
    delete process.env['JWT_SECRET'];

    const env = loadEnv();
    assert.equal(env.KAZIBET_ENVIRONMENT, 'SANDBOX');
    assert.ok(env.JWT_SECRET.length >= 32);
  });

  test('refuses to start outside SANDBOX if JWT_SECRET is missing', () => {
    process.env['KAZIBET_ENVIRONMENT'] = 'PRODUCTION_ACTIVE';
    delete process.env['JWT_SECRET'];

    assert.throws(
      () => loadEnv(),
      /Fatal configuration error: JWT_SECRET environment variable is missing or shorter than 32 characters outside SANDBOX/
    );
  });

  test('refuses to start outside SANDBOX if JWT_SECRET is shorter than 32 characters', () => {
    process.env['KAZIBET_ENVIRONMENT'] = 'PRODUCTION_PENDING';
    process.env['JWT_SECRET'] = 'too-short-secret';

    assert.throws(
      () => loadEnv(),
      /Fatal configuration error: JWT_SECRET environment variable is missing or shorter than 32 characters outside SANDBOX/
    );
  });

  test('succeeds outside SANDBOX when valid >= 32 character JWT_SECRET is provided', () => {
    process.env['KAZIBET_ENVIRONMENT'] = 'PRODUCTION_APPROVED';
    process.env['JWT_SECRET'] = 'a-very-secure-jwt-secret-that-exceeds-32-chars-easily!';

    const env = loadEnv();
    assert.equal(env.KAZIBET_ENVIRONMENT, 'PRODUCTION_APPROVED');
    assert.equal(env.JWT_SECRET, 'a-very-secure-jwt-secret-that-exceeds-32-chars-easily!');
  });

  // Cleanup
  process.env = originalEnv;
});
