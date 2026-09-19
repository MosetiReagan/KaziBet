import { TenantId, UserId, KaziBetError } from '@kazibet/shared';
import { TenantContextHolder } from '@kazibet/tenant';
import { NotificationChannel, NotificationMessage, NotificationProvider } from './provider-interface.js';

export class NotificationService {
  private providers = new Map<NotificationChannel, NotificationProvider>();

  public registerProvider(provider: NotificationProvider): void {
    this.providers.set(provider.channel, provider);
  }

  public async notifyDepositReceived(params: {
    tenantId: TenantId;
    userId: UserId;
    recipient: string;
    amountFormatted: string;
  }): Promise<void> {
    TenantContextHolder.assertTenant(params.tenantId);
    const content = `KaziBet: Your deposit of ${params.amountFormatted} has been credited to your wallet. Game responsibly.`;
    await this.dispatch({
      tenantId: params.tenantId,
      userId: params.userId,
      channel: 'SMS',
      recipient: params.recipient,
      content
    });
  }

  public async notifyBetWon(params: {
    tenantId: TenantId;
    userId: UserId;
    recipient: string;
    payoutFormatted: string;
  }): Promise<void> {
    TenantContextHolder.assertTenant(params.tenantId);
    const content = `Congratulations! Your bet has won ${params.payoutFormatted} and is available in your account balance.`;
    await this.dispatch({
      tenantId: params.tenantId,
      userId: params.userId,
      channel: 'SMS',
      recipient: params.recipient,
      content
    });
  }

  private async dispatch(message: NotificationMessage): Promise<void> {
    const provider = this.providers.get(message.channel);
    if (!provider) {
      // Graceful fallback if channel provider is not registered in dev
      return;
    }
    await provider.send(message);
  }
}
