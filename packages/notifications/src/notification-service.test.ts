import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TenantContextHolder } from '@kazibet/tenant';
import { NotificationService } from './notification-service.js';
import { MockNotificationProvider } from './mock-provider.js';

describe('NotificationService Suite', () => {
  const tenantId = 'tenant-notif-test';
  const userId = 'user-notif-1';

  test('dispatches SMS notification for deposit and bet win', async () => {
    const service = new NotificationService();
    const smsMock = new MockNotificationProvider('SMS');
    service.registerProvider(smsMock);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'notif-test',
        domain: 'notif.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        await service.notifyDepositReceived({
          tenantId,
          userId,
          recipient: '+254700000000',
          amountFormatted: 'KES 500.00'
        });

        assert.equal(smsMock.sentMessages.length, 1);
        assert.ok(smsMock.sentMessages[0]?.content.includes('KES 500.00'));

        await service.notifyBetWon({
          tenantId,
          userId,
          recipient: '+254700000000',
          payoutFormatted: 'KES 1,200.00'
        });

        assert.equal(smsMock.sentMessages.length, 2);
        assert.ok(smsMock.sentMessages[1]?.content.includes('KES 1,200.00'));
      }
    );
  });
});
