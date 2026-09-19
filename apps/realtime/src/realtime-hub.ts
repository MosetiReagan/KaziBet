import { TenantId } from '@kazibet/shared';

export interface RealtimeMessage {
  tenantId: TenantId;
  channel: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export type MessageListener = (msg: RealtimeMessage) => void;

export class RealtimeHub {
  private channels = new Map<string, Set<MessageListener>>();

  private getChannelKey(tenantId: TenantId, channel: string): string {
    return `${tenantId}:${channel}`;
  }

  public subscribe(tenantId: TenantId, channel: string, listener: MessageListener): () => void {
    const key = this.getChannelKey(tenantId, channel);
    if (!this.channels.has(key)) {
      this.channels.set(key, new Set());
    }
    this.channels.get(key)!.add(listener);

    return () => {
      const set = this.channels.get(key);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.channels.delete(key);
      }
    };
  }

  public broadcast(message: RealtimeMessage): void {
    const key = this.getChannelKey(message.tenantId, message.channel);
    const listeners = this.channels.get(key);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(message);
        } catch {
          // ignore client dispatch errors
        }
      }
    }
  }

  public getSubscriberCount(tenantId: TenantId, channel: string): number {
    const key = this.getChannelKey(tenantId, channel);
    return this.channels.get(key)?.size ?? 0;
  }
}
