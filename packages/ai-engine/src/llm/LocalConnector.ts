import type { ProcessMetrics } from '@novapm/shared';
import type { AnomalyEvent, AnalysisResult, LLMConfig, AIInsight } from '../types.js';
import type { LLMConnector } from './LLMConnector.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const SYSTEM_PROMPT = `You are an AI assistant integrated into NovaPM, a next-generation Node.js process manager.
You analyze process metrics, logs, and anomalies to help DevOps engineers maintain healthy applications.
Always provide actionable, specific recommendations. Be concise but thorough.`;

interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * LLM connector for local Ollama instances.
 * Communicates via HTTP to a locally running Ollama server.
 */
export class LocalConnector implements LLMConnector {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;

  constructor(config: LLMConfig) {
    this.baseUrl = DEFAULT_OLLAMA_URL;
    this.model = config.model || 'llama3';
    this.temperature = config.temperature ?? 0.3;
  }

  async query(prompt: string, context?: string): Promise<string> {
    let fullPrompt = `${SYSTEM_PROMPT}\n\n`;

    if (context) {
      fullPrompt += `Context:\n${context}\n\n`;
    }

    fullPrompt += prompt;

    return this.callAPI(fullPrompt);
  }

  async analyzeLog(logs: string[]): Promise<AnalysisResult> {
    const logsText = logs.slice(-50).join('\n'); // Smaller limit for local models
    const prompt = `Analyze the following process logs and provide:
1. A brief summary of what's happening
2. Any insights about potential issues
3. Specific recommendations for improvement
4. Any anomalies detected

Respond in JSON format:
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
    const prompt = `Explain this anomaly in a Node.js process manager context:

Type: ${anomaly.type}
Severity: ${anomaly.severity}
Process: ${anomaly.processName} (PID: ${anomaly.processId})
Metric: ${anomaly.metric}
Value: ${anomaly.value}, Threshold: ${anomaly.threshold}
Description: ${anomaly.description}

Explain what this means and suggest fixes.`;

    return this.query(prompt);
  }

  async suggestOptimization(metrics: ProcessMetrics[]): Promise<string> {
    const summary = this.summarizeMetrics(metrics);
    const prompt = `Suggest optimizations for this Node.js process:

${summary}

Focus on CPU, memory, event loop, and scaling recommendations.`;

    return this.query(prompt);
  }

  private async callAPI(prompt: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false,
            options: {
              temperature: this.temperature,
            },
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Ollama API error (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as OllamaResponse;
        return data.response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    throw new Error(`Ollama API call failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
  }

  private parseAnalysisResult(response: string): AnalysisResult {
    try {
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

    const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;

    return `Process ID: ${latest.processId}
Data points: ${metrics.length}
CPU: avg=${avgCpu.toFixed(1)}%, max=${Math.max(...cpuValues).toFixed(1)}%
Memory: avg=${(avgMemory / 1024 / 1024).toFixed(1)}MB
Heap: ${(latest.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(latest.heapTotal / 1024 / 1024).toFixed(1)}MB
Event Loop Latency: ${latest.eventLoopLatency.toFixed(1)}ms
Uptime: ${(latest.uptime / 3600).toFixed(1)} hours`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
