import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  name?: string;
  level?: LogLevel;
  pretty?: boolean;
  destination?: string;
}

export function createLogger(options: CreateLoggerOptions = {}): pino.Logger {
  const { name = 'novapm', level = 'info', pretty = false, destination } = options;

  const transport = pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

  const dest = destination ? pino.destination(destination) : undefined;

  return pino(
    {
      name,
      level,
      transport: dest ? undefined : transport,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    dest,
  );
}

let defaultLogger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!defaultLogger) {
    defaultLogger = createLogger({ pretty: process.env.NODE_ENV !== 'production' });
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: pino.Logger): void {
  defaultLogger = logger;
}
