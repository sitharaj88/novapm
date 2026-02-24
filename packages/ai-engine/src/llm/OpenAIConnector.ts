import type { ProcessMetrics } from '@novapm/shared';
import type { AnomalyEvent, AnalysisResult, LLMConfig, AIInsight } from '../types.js';
import type { LLMConnector } from './LLMConnector.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const SYSTEM_PROMPT = `You are an AI assistant integrated into NovaPM, a next-generation Node.js process manager.
You analyze process metrics, logs, and anomalies to help DevOps engineers maintain healthy applications.
Always provide actionable, specific recommendations. Be concise but thorough.
When analyzing metrics, consider CPU usage, memory consumption, event loop latency, heap usage, and error rates.`;

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM connector for OpenAI's chat completions API.
 * Uses raw fetch (no SDK dependency) for minimal footprint.
 */
export class OpenAIConnector implements LLMConnector {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 2048;
    this.temperature = config.temperature ?? 0.3;
  }

  async query(prompt: string, context?: string): Promise<string> {
    const messages: OpenAIChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (context) {
      messages.push({
        role: 'user',
        content: `Context:\n${context}`,
      });
    }

    messages.push({ role: 'user', content: prompt });

    return this.callAPI(messages);
  }

  async analyzeLog(logs: string[]): Promise<AnalysisResult> {
    const logsText = logs.slice(-100).join('\n');
    const prompt = `Analyze the following process logs and provide:
1. A brief summary of what's happening
2. Any insights about potential issues
3. Specific recommendations for improvement
4. Any anomalies detected in the log patterns

Respond in JSON format with the following structure:
{
  "summary": "...",
  "insights": [{"title": "...", "description": "...", "severity": "low|medium|high|critical", "recommendation": "..."}],
  "recommendations": ["..."],
  "anomalies": ["..."]
}

Logs:
${logsText}`;

    const response = await this.query(prompt);
    return this.parseAnalysisResult(response);
  }

  async explainAnomaly(anomaly: AnomalyEvent): Promise<string> {
    const prompt = `Explain the following anomaly detected by NovaPM in simple, actionable terms:

Type: ${anomaly.type}
Severity: ${anomaly.severity}
Process: ${anomaly.processName} (PID: ${anomaly.processId})
Metric: ${anomaly.metric}
Current Value: ${anomaly.value}
Threshold: ${anomaly.threshold}
Description: ${anomaly.description}

Provide:
1. What this anomaly means
2. Possible root causes
3. Recommended immediate actions
4. Long-term fixes`;

    return this.query(prompt);
  }

  async suggestOptimization(metrics: ProcessMetrics[]): Promise<string> {
    const summary = this.summarizeMetrics(metrics);
    const prompt = `Based on the following process metrics summary, suggest optimizations:

${summary}

Consider:
1. CPU optimization opportunities
2. Memory usage improvements
3. Instance scaling recommendations
4. Event loop performance
5. General Node.js best practices`;

    return this.query(prompt);
  }

  private async callAPI(messages: OpenAIChatMessage[]): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as OpenAIChatResponse;

        if (!data.choices || data.choices.length === 0) {
          throw new Error('OpenAI returned no choices');
        }

        return data.choices[0].message.content;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    throw new Error(`OpenAI API call failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
  }

  private parseAnalysisResult(response: string): AnalysisResult {
    try {
      // Try to extract JSON from the response (it may be wrapped in markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackAnalysisResult(response);
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        summary?: string;
        insights?: {
          title?: string;
          description?: string;
          severity?: string;
          recommendation?: string;
        }[];
        recommendations?: string[];
        anomalies?: string[];
      };

      const insights: AIInsight[] = (parsed.insights ?? []).map((insight, index) => ({
        id: `insight-${Date.now()}-${index}`,
        type: 'log-analysis',
        title: insight.title ?? 'Insight',
        description: insight.description ?? '',
        severity: this.validateSeverity(insight.severity),
        recommendation: insight.recommendation ?? '',
        timestamp: new Date(),
        acknowledged: false,
      }));

      return {
        summary: parsed.summary ?? response,
        insights,
        recommendations: parsed.recommendations ?? [],
        anomalies: [],
      };
    } catch {
      return this.fallbackAnalysisResult(response);
    }
  }

  private fallbackAnalysisResult(response: string): AnalysisResult {
    return {
      summary: response,
      insights: [],
      recommendations: [],
      anomalies: [],
    };
  }

  private validateSeverity(severity?: string): 'low' | 'medium' | 'high' | 'critical' {
    const valid = ['low', 'medium', 'high', 'critical'] as const;
    if (severity && valid.includes(severity as (typeof valid)[number])) {
      return severity as (typeof valid)[number];
    }
    return 'medium';
  }

  private summarizeMetrics(metrics: ProcessMetrics[]): string {
    if (metrics.length === 0) return 'No metrics available';

    const latest = metrics[metrics.length - 1];
    const cpuValues = metrics.map((m) => m.cpu);
    const memoryValues = metrics.map((m) => m.memory);
    const latencyValues = metrics.map((m) => m.eventLoopLatency);

    const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    const maxCpu = Math.max(...cpuValues);
    const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;
    const maxMemory = Math.max(...memoryValues);
    const avgLatency = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;

    return `Process ID: ${latest.processId}
Data points: ${metrics.length}
CPU: avg=${avgCpu.toFixed(1)}%, max=${maxCpu.toFixed(1)}%
Memory: avg=${(avgMemory / 1024 / 1024).toFixed(1)}MB, max=${(maxMemory / 1024 / 1024).toFixed(1)}MB
Event Loop Latency: avg=${avgLatency.toFixed(1)}ms
Heap Used: ${(latest.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(latest.heapTotal / 1024 / 1024).toFixed(1)}MB
Active Handles: ${latest.activeHandles}
Active Requests: ${latest.activeRequests}
Uptime: ${(latest.uptime / 3600).toFixed(1)} hours`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
