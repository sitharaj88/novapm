import type { ProcessMetrics } from '@novapm/shared';
import type { AnomalyEvent, AnalysisResult, LLMConfig } from '../types.js';
import { OpenAIConnector } from './OpenAIConnector.js';
import { AnthropicConnector } from './AnthropicConnector.js';
import { LocalConnector } from './LocalConnector.js';

/**
 * Abstract interface for LLM connectors.
 * All providers must implement these methods.
 */
export interface LLMConnector {
  /**
   * Send a raw query to the LLM.
   */
  query(prompt: string, context?: string): Promise<string>;

  /**
   * Analyze log entries and return structured insights.
   */
  analyzeLog(logs: string[]): Promise<AnalysisResult>;

  /**
   * Get a human-readable explanation for an anomaly.
   */
  explainAnomaly(anomaly: AnomalyEvent): Promise<string>;

  /**
   * Suggest optimizations based on process metrics.
   */
  suggestOptimization(metrics: ProcessMetrics[]): Promise<string>;
}

/**
 * Factory function to create the appropriate LLM connector
 * based on the provider configuration.
 */
export function createConnector(config: LLMConfig): LLMConnector {
  switch (config.provider) {
    case 'openai':
      return new OpenAIConnector(config);
    case 'anthropic':
      return new AnthropicConnector(config);
    case 'local':
      return new LocalConnector(config);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${_exhaustive}`);
    }
  }
}
