/**
 * AI-specific types for NovaPM's AI Engine.
 */

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnomalyType =
  | 'memory-leak'
  | 'cpu-spike'
  | 'error-rate'
  | 'latency'
  | 'restart-loop'
  | 'memory-threshold'
  | 'cpu-threshold';

export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  processId: number;
  processName: string;
  metric: string;
  description: string;
  value: number;
  threshold: number;
  recommendation: string;
  timestamp: Date;
  resolved: boolean;
}

export interface AIInsight {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: AnomalySeverity;
  processId?: number;
  recommendation: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface ScalingEvent {
  processId: number;
  processName: string;
  direction: 'up' | 'down';
  fromInstances: number;
  toInstances: number;
  reason: string;
  timestamp: Date;
}

export type LLMProvider = 'openai' | 'anthropic' | 'local';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface AnalysisResult {
  summary: string;
  insights: AIInsight[];
  recommendations: string[];
  anomalies: AnomalyEvent[];
}

export interface AutoScalerConfig {
  min: number;
  max: number;
  cpuThreshold: number;
  memoryThreshold: number;
  cooldown: number;
  scaleUpStep: number;
  scaleDownStep: number;
}

export interface ZScoreResult {
  index: number;
  value: number;
  zScore: number;
}

export interface IQRResult {
  index: number;
  value: number;
  isOutlier: boolean;
}

export interface MovingAverageResult {
  index: number;
  value: number;
  ema: number;
  deviation: number;
}

export interface RateOfChangeResult {
  index: number;
  value: number;
  rate: number;
}
