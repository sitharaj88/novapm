import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import type {
  ProcessEvent,
  ProcessMetrics,
  SystemMetrics,
  LogEntry,
  EventBusMessage,
} from '@novapm/shared';

type EventMap = {
  'process:start': ProcessEvent;
  'process:stop': ProcessEvent;
  'process:restart': ProcessEvent;
  'process:error': ProcessEvent;
  'process:exit': ProcessEvent;
  'process:crash': ProcessEvent;
  'process:online': ProcessEvent;
  'process:scaling': ProcessEvent;
  'metric:process': ProcessMetrics;
  'metric:system': SystemMetrics;
  'log:entry': LogEntry;
  'health:fail': ProcessEvent;
  'health:restore': ProcessEvent;
  'system:shutdown': undefined;
  'system:config-reload': undefined;
};

type EventName = keyof EventMap;

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  emit<K extends EventName>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
    // Also emit a generic message for subscribers that want everything
    const message: EventBusMessage = {
      id: nanoid(),
      type: event,
      source: 'core',
      timestamp: new Date(),
      data,
    };
    this.emitter.emit('*', message);
  }

  on<K extends EventName>(event: K, handler: (data: EventMap[K]) => void): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  once<K extends EventName>(event: K, handler: (data: EventMap[K]) => void): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off<K extends EventName>(event: K, handler: (data: EventMap[K]) => void): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  onAny(handler: (message: EventBusMessage) => void): void {
    this.emitter.on('*', handler);
  }

  offAny(handler: (message: EventBusMessage) => void): void {
    this.emitter.off('*', handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

let defaultEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!defaultEventBus) {
    defaultEventBus = new EventBus();
  }
  return defaultEventBus;
}
