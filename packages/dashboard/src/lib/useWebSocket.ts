'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getWebSocketUrl } from './api';

interface UseWebSocketOptions {
  path: string;
  onMessage: (data: unknown) => void;
  enabled?: boolean;
  reconnectInterval?: number;
}

export function useWebSocket({
  path,
  onMessage,
  enabled = true,
  reconnectInterval = 3000,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) return;

    const connect = () => {
      try {
        const url = getWebSocketUrl(path);
        const ws = new WebSocket(url);

        ws.onopen = () => {
          setConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessageRef.current(data);
          } catch {
            // Ignore non-JSON messages
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          reconnectTimerRef.current = setTimeout(connect, reconnectInterval);
        };

        ws.onerror = () => {
          ws.close();
        };

        wsRef.current = ws;
      } catch {
        // Connection failed, retry
        reconnectTimerRef.current = setTimeout(connect, reconnectInterval);
      }
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [path, enabled, reconnectInterval]);

  return { connected };
}

interface SystemMetricsPoint {
  [key: string]: string | number;
  time: string;
  cpu: number;
  memory: number;
  load: number;
  timestamp: number;
}

const MAX_BUFFER_SIZE = 200;

export function useSystemMetricsBuffer() {
  const [buffer, setBuffer] = useState<SystemMetricsPoint[]>([]);

  const addPoint = useCallback((data: unknown) => {
    const d = data as {
      cpuUsage?: number;
      memoryUsed?: number;
      memoryTotal?: number;
      loadAvg?: number[];
      timestamp?: { getTime?: () => number } | string;
    };
    if (d && typeof d.cpuUsage === 'number') {
      const now = Date.now();
      const time = new Date(now);
      const point: SystemMetricsPoint = {
        time: `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`,
        cpu: d.cpuUsage,
        memory: d.memoryTotal ? ((d.memoryUsed || 0) / d.memoryTotal) * 100 : 0,
        load: d.loadAvg?.[0] || 0,
        timestamp: now,
      };

      setBuffer((prev) => {
        const updated = [...prev, point];
        return updated.length > MAX_BUFFER_SIZE ? updated.slice(-MAX_BUFFER_SIZE) : updated;
      });
    }
  }, []);

  return { buffer, addPoint };
}
