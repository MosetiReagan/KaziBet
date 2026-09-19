import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityValidator } from './capability-validator.js';
import { createKenyaReferenceConfig } from './reference-kenya.js';

describe('Capability Validator & Safety Gate', () => {
  test('rejects default sandbox config from production activation', () => {
    const sandboxConfig = createKenyaReferenceConfig();
    const result = CapabilityValidator.validateForProduction(sandboxConfig);

    assert.equal(result.valid, false);
    assert.ok(result.issues.length > 0);
    const issueFields = result.issues.map(i => i.field);
    assert.ok(issueFields.includes('domain'));
    assert.ok(issueFields.includes('providers.kyc'));
    assert.ok(issueFields.includes('providers.paymentGateways'));
  });

  test('assertRealMoneyAllowed throws for SANDBOX mode', () => {
    const sandboxConfig = createKenyaReferenceConfig({ capabilityStatus: 'SANDBOX' });
    assert.throws(
      () => CapabilityValidator.assertRealMoneyAllowed(sandboxConfig),
      /Real-money transaction rejected/
    );
  });

  test('assertRealMoneyAllowed succeeds for PRODUCTION_ACTIVE mode', () => {
    const prodConfig = createKenyaReferenceConfig({ capabilityStatus: 'PRODUCTION_ACTIVE' });
    assert.doesNotThrow(() => CapabilityValidator.assertRealMoneyAllowed(prodConfig));
  });
});
