import { z } from 'zod';

export const ipcMethodSchema = z.enum([
  'daemon.ping',
  'daemon.stop',
  'daemon.version',
  'process.start',
  'process.stop',
  'process.restart',
  'process.delete',
  'process.list',
  'process.info',
  'process.scale',
  'logs.stream',
  'logs.flush',
  'logs.recent',
  'metrics.get',
  'metrics.system',
  'config.reload',
]);

export const ipcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string(),
  method: ipcMethodSchema,
  params: z.record(z.unknown()).optional(),
});

export const ipcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const ipcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string(),
  result: z.unknown().optional(),
  error: ipcErrorSchema.optional(),
});
