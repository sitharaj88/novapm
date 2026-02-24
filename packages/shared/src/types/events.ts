export interface EventBusMessage {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: unknown;
}
