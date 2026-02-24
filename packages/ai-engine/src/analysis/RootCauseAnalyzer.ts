import type { ProcessMetrics, ProcessEvent } from '@novapm/shared';
import type { AnalysisResult, AIInsight, AnomalySeverity } from '../types.js';

/** Common crash patterns and their signatures in log output. */
const CRASH_PATTERNS: {
  pattern: RegExp;
  type: string;
  title: string;
  severity: AnomalySeverity;
  recommendation: string;
}[] = [
  {
    pattern: /FATAL ERROR: .*(heap|allocation|memory)/i,
    type: 'oom',
    title: 'Out of Memory (OOM) Crash',
    severity: 'critical',
    recommendation:
      'Increase memory limit with --max-old-space-size, set max_memory_restart, or investigate memory leaks using heap snapshots.',
  },
  {
    pattern: /JavaScript heap out of memory/i,
    type: 'oom',
    title: 'JavaScript Heap Exhaustion',
    severity: 'critical',
    recommendation:
      'The V8 heap is exhausted. Increase Node.js memory with --max-old-space-size=4096 or optimize memory-intensive operations.',
  },
  {
    pattern: /unhandled(?:Promise)?Rejection|UnhandledPromiseRejection/i,
    type: 'unhandled-rejection',
    title: 'Unhandled Promise Rejection',
    severity: 'high',
    recommendation:
      'Add proper error handling for promises. Use process.on("unhandledRejection") as a safety net.',
  },
  {
    pattern: /uncaught(?:Exception)?|ReferenceError|TypeError|SyntaxError/i,
    type: 'uncaught-exception',
    title: 'Uncaught Exception',
    severity: 'high',
    recommendation:
      'Fix the underlying code error. Add try-catch blocks around risky operations. Use process.on("uncaughtException") for logging.',
  },
  {
    pattern: /EADDRINUSE/i,
    type: 'port-in-use',
    title: 'Port Already in Use',
    severity: 'high',
    recommendation:
      'Another process is using the same port. Check for zombie processes, configure a different port, or use cluster mode with port sharing.',
  },
  {
    pattern: /ECONNREFUSED/i,
    type: 'connection-refused',
    title: 'Connection Refused to Dependency',
    severity: 'medium',
    recommendation:
      'A dependent service (database, cache, API) is unavailable. Check that all dependencies are running and accessible.',
  },
  {
    pattern: /Cannot find module|MODULE_NOT_FOUND/i,
    type: 'missing-module',
    title: 'Missing Module/Dependency',
    severity: 'high',
    recommendation:
      'Run npm install or pnpm install. Check that the module exists in package.json and node_modules.',
  },
  {
    pattern: /ENOSPC/i,
    type: 'disk-full',
    title: 'Disk Space Exhausted',
    severity: 'critical',
    recommendation:
      'The disk is full. Free up space by rotating logs, clearing temp files, or increasing disk capacity.',
  },
  {
    pattern: /EMFILE|too many open files/i,
    type: 'file-descriptor-exhaustion',
    title: 'Too Many Open Files',
    severity: 'high',
    recommendation:
      'The process has exhausted file descriptors. Increase ulimit -n, or fix file handle leaks in the application.',
  },
  {
    pattern: /SIGKILL|killed/i,
    type: 'killed',
    title: 'Process Killed (SIGKILL)',
    severity: 'high',
    recommendation:
      'The process was forcefully killed, likely by the OOM killer or a deployment. Check system dmesg logs and memory limits.',
  },
];

let insightIdCounter = 1;

function generateInsightId(): string {
  return `insight-rca-${Date.now()}-${insightIdCounter++}`;
}

/**
 * Analyzes process crashes to determine root causes by examining
 * logs, metrics, and event correlation.
 */
export class RootCauseAnalyzer {
  /**
   * Analyze a process crash to determine the most likely root cause.
   */
  analyzeProcessCrash(
    processId: number,
    recentLogs: string[],
    recentMetrics: ProcessMetrics[],
    recentEvents: ProcessEvent[],
  ): AnalysisResult {
    const insights: AIInsight[] = [];
    const recommendations: string[] = [];

    // --- 1. Pattern matching on logs ---
    const logInsights = this.analyzeLogPatterns(processId, recentLogs);
    insights.push(...logInsights);

    // --- 2. Metrics-based analysis ---
    const metricsInsights = this.analyzeMetricsBeforeCrash(processId, recentMetrics);
    insights.push(...metricsInsights);

    // --- 3. Event correlation ---
    const eventInsights = this.analyzeEventCorrelation(processId, recentEvents);
    insights.push(...eventInsights);

    // Collect unique recommendations
    for (const insight of insights) {
      if (insight.recommendation && !recommendations.includes(insight.recommendation)) {
        recommendations.push(insight.recommendation);
      }
    }

    // Generate summary
    const summary = this.generateSummary(processId, insights, recentEvents);

    return {
      summary,
      insights,
      recommendations,
      anomalies: [],
    };
  }

  /**
   * Search logs for known crash patterns.
   */
  private analyzeLogPatterns(processId: number, logs: string[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const matchedTypes = new Set<string>();

    for (const log of logs) {
      for (const crashPattern of CRASH_PATTERNS) {
        if (crashPattern.pattern.test(log) && !matchedTypes.has(crashPattern.type)) {
          matchedTypes.add(crashPattern.type);
          insights.push({
            id: generateInsightId(),
            type: crashPattern.type,
            title: crashPattern.title,
            description: `Detected in logs: "${log.slice(0, 200)}"`,
            severity: crashPattern.severity,
            processId,
            recommendation: crashPattern.recommendation,
            timestamp: new Date(),
            acknowledged: false,
          });
        }
      }
    }

    return insights;
  }

  /**
   * Analyze metrics leading up to the crash for unusual patterns.
   */
  private analyzeMetricsBeforeCrash(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];

    if (metrics.length < 2) {
      return insights;
    }

    // Check for memory spike before crash
    const memoryValues = metrics.map((m) => m.memory);
    const lastMemory = memoryValues[memoryValues.length - 1];
    const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;

    if (lastMemory > avgMemory * 2 && lastMemory > 256 * 1024 * 1024) {
      insights.push({
        id: generateInsightId(),
        type: 'memory-spike-before-crash',
        title: 'Memory Spike Before Crash',
        description: `Memory spiked to ${(lastMemory / 1024 / 1024).toFixed(0)}MB (avg: ${(avgMemory / 1024 / 1024).toFixed(0)}MB) before the crash.`,
        severity: 'high',
        processId,
        recommendation:
          'The crash was likely caused by excessive memory allocation. Profile memory usage and look for large allocations.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Check for high CPU before crash (possible infinite loop)
    const cpuValues = metrics.map((m) => m.cpu);
    const lastCpu = cpuValues[cpuValues.length - 1];

    if (lastCpu > 95) {
      insights.push({
        id: generateInsightId(),
        type: 'high-cpu-before-crash',
        title: 'High CPU Before Crash',
        description: `CPU was at ${lastCpu.toFixed(1)}% before the crash, suggesting a CPU-bound operation or infinite loop.`,
        severity: 'high',
        processId,
        recommendation:
          'Profile CPU usage to identify hot code paths. Check for infinite loops or excessive computation.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Check for high event loop latency (blocking operation)
    const latencyValues = metrics.map((m) => m.eventLoopLatency);
    const lastLatency = latencyValues[latencyValues.length - 1];

    if (lastLatency > 500) {
      insights.push({
        id: generateInsightId(),
        type: 'event-loop-blocked',
        title: 'Event Loop Blocked Before Crash',
        description: `Event loop latency was ${lastLatency.toFixed(0)}ms before the crash, indicating a blocking operation.`,
        severity: 'medium',
        processId,
        recommendation:
          'Move CPU-intensive operations to worker threads. Avoid synchronous I/O operations.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Check for heap growing to limit
    const heapRatios = metrics.map((m) => (m.heapTotal > 0 ? m.heapUsed / m.heapTotal : 0));
    const lastHeapRatio = heapRatios[heapRatios.length - 1];

    if (lastHeapRatio > 0.95) {
      insights.push({
        id: generateInsightId(),
        type: 'heap-exhaustion',
        title: 'V8 Heap Near Limit Before Crash',
        description: `Heap utilization was at ${(lastHeapRatio * 100).toFixed(0)}% before the crash.`,
        severity: 'critical',
        processId,
        recommendation:
          'The V8 heap was nearly full. Increase --max-old-space-size or reduce memory consumption.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Analyze event correlation: did other processes crash at the same time?
   * Are there restart loops?
   */
  private analyzeEventCorrelation(processId: number, events: ProcessEvent[]): AIInsight[] {
    const insights: AIInsight[] = [];

    // Find crash/error events for this process
    const crashEvents = events.filter(
      (e) =>
        e.processId === processId &&
        (e.type === 'crash' || e.type === 'error' || e.type === 'exit'),
    );

    if (crashEvents.length === 0) {
      return insights;
    }

    const latestCrash = crashEvents[crashEvents.length - 1];
    const crashTime = latestCrash.timestamp.getTime();
    const correlationWindowMs = 60_000; // 1 minute

    // Check if other processes crashed around the same time
    const correlatedCrashes = events.filter(
      (e) =>
        e.processId !== processId &&
        (e.type === 'crash' || e.type === 'error') &&
        Math.abs(e.timestamp.getTime() - crashTime) < correlationWindowMs,
    );

    if (correlatedCrashes.length > 0) {
      const affectedProcesses = [...new Set(correlatedCrashes.map((e) => e.processName))];
      insights.push({
        id: generateInsightId(),
        type: 'correlated-crashes',
        title: 'Correlated Crashes Across Processes',
        description: `Other processes crashed within 1 minute: ${affectedProcesses.join(', ')}. This suggests a shared dependency issue.`,
        severity: 'critical',
        processId,
        recommendation:
          'Multiple processes crashing simultaneously often indicates a shared dependency failure (database, network, shared resource).',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Detect restart loops
    const tenMinutesMs = 10 * 60 * 1000;
    const recentRestarts = events.filter(
      (e) =>
        e.processId === processId &&
        e.type === 'restart' &&
        crashTime - e.timestamp.getTime() < tenMinutesMs,
    );

    if (recentRestarts.length > 5) {
      insights.push({
        id: generateInsightId(),
        type: 'restart-loop',
        title: 'Restart Loop Detected',
        description: `Process has restarted ${recentRestarts.length} times in the last 10 minutes.`,
        severity: 'critical',
        processId,
        recommendation:
          'The process is in a crash-restart loop. Disable autorestart temporarily and investigate the root cause from logs.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Generate a human-readable summary of the crash analysis.
   */
  private generateSummary(
    processId: number,
    insights: AIInsight[],
    events: ProcessEvent[],
  ): string {
    if (insights.length === 0) {
      return `Process ${processId} crashed but no clear root cause was identified from available data. Check application logs for more details.`;
    }

    const criticalInsights = insights.filter((i) => i.severity === 'critical');
    const highInsights = insights.filter((i) => i.severity === 'high');

    const parts: string[] = [`Root cause analysis for process ${processId}:`];

    if (criticalInsights.length > 0) {
      parts.push(`Critical issues: ${criticalInsights.map((i) => i.title).join(', ')}.`);
    }
    if (highInsights.length > 0) {
      parts.push(`High-severity issues: ${highInsights.map((i) => i.title).join(', ')}.`);
    }

    const crashCount = events.filter((e) => e.processId === processId && e.type === 'crash').length;
    if (crashCount > 1) {
      parts.push(`The process has crashed ${crashCount} times in the observed period.`);
    }

    return parts.join(' ');
  }
}
