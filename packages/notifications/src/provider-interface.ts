import { TenantId, UserId } from '@kazibet/shared';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

export interface NotificationMessage {
  tenantId: TenantId;
  userId: UserId;
  channel: NotificationChannel;
  recipient: string; // email address or phone number
  subject?: string;
  content: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<{ success: boolean; messageId: string }>;
}
