import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../events/EventBus.js';
import type { ProcessEvent, EventBusMessage } from '@novapm/shared';

// Mock nanoid to return deterministic IDs
vi.mock('nanoid', () => ({
  nanoid: () => 'test-id-123',
}));

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('emit and on', () => {
    it('should emit an event and call the listener with correct data', () => {
      const handler = vi.fn();
      const eventData: ProcessEvent = {
        type: 'start',
        processId: 1,
        processName: 'test-app',
        timestamp: new Date('2026-01-01'),
        data: { pid: 1234 },
      };

      eventBus.on('process:start', handler);
      eventBus.emit('process:start', eventData);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(eventData);
    });

    it('should support multiple listeners on the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      const eventData: ProcessEvent = {
        type: 'stop',
        processId: 2,
        processName: 'web-server',
        timestamp: new Date(),
        data: { force: false },
      };

      eventBus.on('process:stop', handler1);
      eventBus.on('process:stop', handler2);
      eventBus.on('process:stop', handler3);

      eventBus.emit('process:stop', eventData);

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
      expect(handler3).toHaveBeenCalledOnce();
      expect(handler1).toHaveBeenCalledWith(eventData);
      expect(handler2).toHaveBeenCalledWith(eventData);
      expect(handler3).toHaveBeenCalledWith(eventData);
    });

    it('should not call listeners for different events', () => {
      const startHandler = vi.fn();
      const stopHandler = vi.fn();

      eventBus.on('process:start', startHandler);
      eventBus.on('process:stop', stopHandler);

      eventBus.emit('process:start', {
        type: 'start',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      });

      expect(startHandler).toHaveBeenCalledOnce();
      expect(stopHandler).not.toHaveBeenCalled();
    });

    it('should pass event data correctly for various event types', () => {
      const crashHandler = vi.fn();
      const crashData: ProcessEvent = {
        type: 'crash',
        processId: 5,
        processName: 'worker',
        timestamp: new Date('2026-06-15T10:30:00Z'),
        data: { exitCode: 1, signal: 'SIGSEGV' },
      };

      eventBus.on('process:crash', crashHandler);
      eventBus.emit('process:crash', crashData);

      expect(crashHandler).toHaveBeenCalledWith(crashData);
      const received = crashHandler.mock.calls[0][0] as ProcessEvent;
      expect(received.processId).toBe(5);
      expect(received.processName).toBe('worker');
      expect(received.data.exitCode).toBe(1);
      expect(received.data.signal).toBe('SIGSEGV');
    });
  });

  describe('once', () => {
    it('should call the handler only once', () => {
      const handler = vi.fn();
      const eventData: ProcessEvent = {
        type: 'restart',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: { pid: 999 },
      };

      eventBus.once('process:restart', handler);

      eventBus.emit('process:restart', eventData);
      eventBus.emit('process:restart', eventData);
      eventBus.emit('process:restart', eventData);

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('off (removeListener)', () => {
    it('should remove a specific listener', () => {
      const handler = vi.fn();
      const eventData: ProcessEvent = {
        type: 'start',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      };

      eventBus.on('process:start', handler);
      eventBus.emit('process:start', eventData);
      expect(handler).toHaveBeenCalledOnce();

      eventBus.off('process:start', handler);
      eventBus.emit('process:start', eventData);
      expect(handler).toHaveBeenCalledOnce(); // still 1, not called again
    });

    it('should only remove the specified listener, leaving others intact', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const eventData: ProcessEvent = {
        type: 'stop',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      };

      eventBus.on('process:stop', handler1);
      eventBus.on('process:stop', handler2);

      eventBus.off('process:stop', handler1);
      eventBus.emit('process:stop', eventData);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for all events', () => {
      const startHandler = vi.fn();
      const stopHandler = vi.fn();
      const crashHandler = vi.fn();

      eventBus.on('process:start', startHandler);
      eventBus.on('process:stop', stopHandler);
      eventBus.on('process:crash', crashHandler);

      eventBus.removeAllListeners();

      eventBus.emit('process:start', {
        type: 'start',
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });
      eventBus.emit('process:stop', {
        type: 'stop',
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });
      eventBus.emit('process:crash', {
        type: 'crash',
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });

      expect(startHandler).not.toHaveBeenCalled();
      expect(stopHandler).not.toHaveBeenCalled();
      expect(crashHandler).not.toHaveBeenCalled();
    });
  });

  describe('wildcard events (onAny / offAny)', () => {
    it('should receive all events via onAny', () => {
      const anyHandler = vi.fn();
      eventBus.onAny(anyHandler);

      eventBus.emit('process:start', {
        type: 'start',
        processId: 1,
        processName: 'app1',
        timestamp: new Date(),
        data: { pid: 100 },
      });

      eventBus.emit('process:stop', {
        type: 'stop',
        processId: 2,
        processName: 'app2',
        timestamp: new Date(),
        data: { force: true },
      });

      expect(anyHandler).toHaveBeenCalledTimes(2);

      // Verify the wildcard message structure
      const firstCall = anyHandler.mock.calls[0][0] as EventBusMessage;
      expect(firstCall.id).toBe('test-id-123');
      expect(firstCall.type).toBe('process:start');
      expect(firstCall.source).toBe('core');
      expect(firstCall.timestamp).toBeInstanceOf(Date);
      expect(firstCall.data).toBeDefined();

      const secondCall = anyHandler.mock.calls[1][0] as EventBusMessage;
      expect(secondCall.type).toBe('process:stop');
    });

    it('should stop receiving events after offAny', () => {
      const anyHandler = vi.fn();
      eventBus.onAny(anyHandler);

      eventBus.emit('process:start', {
        type: 'start',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      });
      expect(anyHandler).toHaveBeenCalledOnce();

      eventBus.offAny(anyHandler);

      eventBus.emit('process:stop', {
        type: 'stop',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      });
      expect(anyHandler).toHaveBeenCalledOnce(); // still 1
    });

    it('should include event data in the wildcard message', () => {
      const anyHandler = vi.fn();
      eventBus.onAny(anyHandler);

      const crashData: ProcessEvent = {
        type: 'crash',
        processId: 7,
        processName: 'api-service',
        timestamp: new Date(),
        data: { exitCode: 137, signal: 'SIGKILL' },
      };

      eventBus.emit('process:crash', crashData);

      const message = anyHandler.mock.calls[0][0] as EventBusMessage;
      expect(message.data).toEqual(crashData);
    });
  });

  describe('system events', () => {
    it('should emit system:shutdown with undefined data', () => {
      const handler = vi.fn();
      eventBus.on('system:shutdown', handler);

      eventBus.emit('system:shutdown', undefined);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it('should emit system:config-reload with undefined data', () => {
      const handler = vi.fn();
      eventBus.on('system:config-reload', handler);

      eventBus.emit('system:config-reload', undefined);

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('edge cases', () => {
    it('should handle emitting an event with no listeners without throwing', () => {
      expect(() => {
        eventBus.emit('process:error', {
          type: 'error',
          processId: 1,
          processName: 'app',
          timestamp: new Date(),
          data: {},
        });
      }).not.toThrow();
    });

    it('should handle removing a listener that was never added without throwing', () => {
      const handler = vi.fn();
      expect(() => {
        eventBus.off('process:start', handler);
      }).not.toThrow();
    });

    it('should handle multiple removeAllListeners calls without throwing', () => {
      eventBus.removeAllListeners();
      expect(() => {
        eventBus.removeAllListeners();
      }).not.toThrow();
    });

    it('should handle a listener being added multiple times', () => {
      const handler = vi.fn();
      eventBus.on('process:start', handler);
      eventBus.on('process:start', handler);

      eventBus.emit('process:start', {
        type: 'start',
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      });

      // EventEmitter calls the same handler twice if added twice
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
