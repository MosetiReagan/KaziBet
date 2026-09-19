export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  tenantId?: string;
  correlationId?: string;
  requestId?: string;
  context?: Record<string, unknown>;
}

export class Logger {
  public static log(level: LogLevel, message: string, meta?: {
    tenantId?: string;
    correlationId?: string;
    requestId?: string;
    context?: Record<string, unknown>;
  }): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      tenantId: meta?.tenantId,
      correlationId: meta?.correlationId,
      requestId: meta?.requestId,
      context: meta?.context
    };

    // Output JSON string to stdout
    return entry;
  }

  public static info(message: string, meta?: Parameters<typeof Logger.log>[2]): StructuredLogEntry {
    return Logger.log('INFO', message, meta);
  }

  public static error(message: string, meta?: Parameters<typeof Logger.log>[2]): StructuredLogEntry {
    return Logger.log('ERROR', message, meta);
  }

  public static warn(message: string, meta?: Parameters<typeof Logger.log>[2]): StructuredLogEntry {
    return Logger.log('WARN', message, meta);
  }
}
