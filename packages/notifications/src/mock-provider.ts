import { generateId } from '@kazibet/shared';
import { NotificationChannel, NotificationMessage, NotificationProvider } from './provider-interface.js';

export class MockNotificationProvider implements NotificationProvider {
  public sentMessages: NotificationMessage[] = [];

  constructor(public readonly channel: NotificationChannel) {}

  public async send(message: NotificationMessage): Promise<{ success: boolean; messageId: string }> {
    this.sentMessages.push(message);
    return {
      success: true,
      messageId: `msg-${generateId().slice(0, 8)}`
    };
  }

  public clear(): void {
    this.sentMessages = [];
  }
}
