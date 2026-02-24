import { mean, standardDeviation } from 'simple-statistics';
import type { ProcessMetrics } from '@novapm/shared';
import type { AIInsight, AnomalySeverity } from '../types.js';

let insightIdCounter = 1;

function generateInsightId(): string {
  return `insight-perf-${Date.now()}-${insightIdCounter++}`;
}

/**
 * Analyzes process metrics and provides performance-related insights
 * and recommendations.
 */
export class PerformanceAdvisor {
  /**
   * Analyze process metrics and generate insights about performance,
   * resource usage, and optimization opportunities.
   */
  analyzeProcess(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];

    if (metrics.length < 3) {
      return insights;
    }

    // Run all analysis checks
    insights.push(...this.checkHighMemoryUsage(processId, metrics));
    insights.push(...this.checkInefficientCpuUsage(processId, metrics));
    insights.push(...this.checkInstanceScaling(processId, metrics));
    insights.push(...this.checkMemoryLimits(processId, metrics));
    insights.push(...this.checkIdleProcess(processId, metrics));
    insights.push(...this.checkEventLoopHealth(processId, metrics));
    insights.push(...this.checkHeapFragmentation(processId, metrics));

    return insights;
  }

  /**
   * Check for consistently high memory usage.
   */
  private checkHighMemoryUsage(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const memoryValues = metrics.map((m) => m.memory);
    const avgMemory = mean(memoryValues);
    const avgMemoryMB = avgMemory / (1024 * 1024);

    // Flag if average memory usage is above 512MB
    if (avgMemoryMB > 512) {
      const severity: AnomalySeverity = avgMemoryMB > 1024 ? 'high' : 'medium';
      insights.push({
        id: generateInsightId(),
        type: 'high-memory',
        title: 'High Memory Usage',
        description: `Average memory usage is ${avgMemoryMB.toFixed(0)}MB. This is above the recommended threshold for a single Node.js process.`,
        severity,
        processId,
        recommendation: `Consider splitting workloads across multiple processes, optimizing data structures, or using streaming for large data processing. Current average: ${avgMemoryMB.toFixed(0)}MB.`,
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Check for growing memory trend (potential slow leak)
    if (metrics.length >= 10) {
      const firstHalf = memoryValues.slice(0, Math.floor(memoryValues.length / 2));
      const secondHalf = memoryValues.slice(Math.floor(memoryValues.length / 2));
      const firstHalfAvg = mean(firstHalf);
      const secondHalfAvg = mean(secondHalf);

      if (secondHalfAvg > firstHalfAvg * 1.3) {
        insights.push({
          id: generateInsightId(),
          type: 'memory-growth',
          title: 'Memory Usage Growing Over Time',
          description: `Memory usage increased by ${((secondHalfAvg / firstHalfAvg - 1) * 100).toFixed(0)}% between the first and second half of the observation period.`,
          severity: 'medium',
          processId,
          recommendation:
            'Memory is trending upward. Monitor for potential memory leaks. Consider taking heap snapshots at intervals to compare allocations.',
          timestamp: new Date(),
          acknowledged: false,
        });
      }
    }

    return insights;
  }

  /**
   * Check for inefficient CPU usage patterns.
   */
  private checkInefficientCpuUsage(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const cpuValues = metrics.map((m) => m.cpu);
    const avgCpu = mean(cpuValues);
    const cpuStdDev = standardDeviation(cpuValues);

    // High variance in CPU usage suggests bursty workloads
    if (cpuStdDev > 30 && avgCpu > 20) {
      insights.push({
        id: generateInsightId(),
        type: 'bursty-cpu',
        title: 'Bursty CPU Usage Pattern',
        description: `CPU usage is highly variable (avg: ${avgCpu.toFixed(1)}%, stddev: ${cpuStdDev.toFixed(1)}%). This suggests bursty workloads that may benefit from load leveling.`,
        severity: 'low',
        processId,
        recommendation:
          'Consider using a job queue to spread CPU-intensive work more evenly. Worker threads can help offload CPU-bound tasks from the main event loop.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // Sustained high CPU
    if (avgCpu > 80) {
      insights.push({
        id: generateInsightId(),
        type: 'sustained-high-cpu',
        title: 'Sustained High CPU Usage',
        description: `Average CPU usage is ${avgCpu.toFixed(1)}%, indicating the process is CPU-bound.`,
        severity: 'high',
        processId,
        recommendation:
          'Scale horizontally by adding more instances in cluster mode. Profile the application to identify CPU hot spots.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Recommend instance count based on CPU utilization.
   */
  private checkInstanceScaling(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const cpuValues = metrics.map((m) => m.cpu);
    const avgCpu = mean(cpuValues);

    // If CPU is consistently above 70%, suggest scaling up
    if (avgCpu > 70) {
      const recommendedInstances = Math.ceil(avgCpu / 50); // target 50% per instance
      insights.push({
        id: generateInsightId(),
        type: 'scale-up-recommendation',
        title: 'Scale Up Recommended',
        description: `With average CPU at ${avgCpu.toFixed(1)}%, the process would benefit from more instances.`,
        severity: 'medium',
        processId,
        recommendation: `Consider scaling to ${recommendedInstances} instances to achieve ~50% CPU utilization per instance. Use cluster mode for automatic load distribution.`,
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // If CPU is consistently very low, suggest scaling down
    if (avgCpu < 5 && metrics.length >= 10) {
      // Only suggest if we have enough data and process isn't just idle/starting
      const latestMetrics = metrics.slice(-5);
      const latestAvgCpu = mean(latestMetrics.map((m) => m.cpu));

      if (latestAvgCpu < 5) {
        insights.push({
          id: generateInsightId(),
          type: 'scale-down-recommendation',
          title: 'Over-Provisioned: Consider Scaling Down',
          description: `CPU usage is consistently below 5% (avg: ${avgCpu.toFixed(1)}%). The process may be over-provisioned.`,
          severity: 'low',
          processId,
          recommendation:
            'If running multiple instances, consider reducing the instance count. The current resource allocation appears excessive for the workload.',
          timestamp: new Date(),
          acknowledged: false,
        });
      }
    }

    return insights;
  }

  /**
   * Recommend memory limits based on actual usage patterns.
   */
  private checkMemoryLimits(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const memoryValues = metrics.map((m) => m.memory);
    const maxMemory = Math.max(...memoryValues);
    const avgMemory = mean(memoryValues);
    const maxMemoryMB = maxMemory / (1024 * 1024);
    const avgMemoryMB = avgMemory / (1024 * 1024);

    // Suggest a memory limit if none appears to be set (based on high usage)
    if (maxMemoryMB > 200) {
      // Recommend a limit at 150% of the observed max
      const recommendedLimitMB = Math.ceil((maxMemoryMB * 1.5) / 50) * 50; // round to nearest 50MB
      insights.push({
        id: generateInsightId(),
        type: 'memory-limit-recommendation',
        title: 'Set Memory Restart Limit',
        description: `Peak memory usage is ${maxMemoryMB.toFixed(0)}MB (avg: ${avgMemoryMB.toFixed(0)}MB).`,
        severity: 'low',
        processId,
        recommendation: `Set max_memory_restart to "${recommendedLimitMB}M" to automatically restart the process if memory usage becomes excessive, preventing OOM crashes.`,
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Flag idle processes that are consistently underutilized.
   */
  private checkIdleProcess(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const cpuValues = metrics.map((m) => m.cpu);
    const memoryValues = metrics.map((m) => m.memory);

    const avgCpu = mean(cpuValues);
    const avgMemoryMB = mean(memoryValues) / (1024 * 1024);

    // Consider a process idle if CPU < 1% and memory < 50MB consistently
    if (avgCpu < 1 && avgMemoryMB < 50 && metrics.length >= 10) {
      insights.push({
        id: generateInsightId(),
        type: 'idle-process',
        title: 'Idle Process Detected',
        description: `Process appears to be idle with average CPU of ${avgCpu.toFixed(2)}% and memory of ${avgMemoryMB.toFixed(0)}MB.`,
        severity: 'low',
        processId,
        recommendation:
          'This process appears to be doing very little work. Verify it is still needed, or check if it is stuck/deadlocked.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Check event loop health based on latency metrics.
   */
  private checkEventLoopHealth(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const latencyValues = metrics.map((m) => m.eventLoopLatency);
    const avgLatency = mean(latencyValues);
    const maxLatency = Math.max(...latencyValues);

    if (avgLatency > 50) {
      insights.push({
        id: generateInsightId(),
        type: 'event-loop-slow',
        title: 'Slow Event Loop',
        description: `Average event loop latency is ${avgLatency.toFixed(1)}ms (max: ${maxLatency.toFixed(1)}ms). Ideal is under 10ms.`,
        severity: avgLatency > 100 ? 'high' : 'medium',
        processId,
        recommendation:
          'High event loop latency indicates blocking operations on the main thread. Move CPU-intensive work to worker threads, avoid synchronous I/O, and break up large computations with setImmediate().',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }

  /**
   * Check for heap fragmentation or inefficient heap usage.
   */
  private checkHeapFragmentation(processId: number, metrics: ProcessMetrics[]): AIInsight[] {
    const insights: AIInsight[] = [];

    // Check ratio of heapUsed to heapTotal
    const heapRatios = metrics.filter((m) => m.heapTotal > 0).map((m) => m.heapUsed / m.heapTotal);

    if (heapRatios.length < 3) {
      return insights;
    }

    const avgHeapRatio = mean(heapRatios);

    // If heap utilization is low, V8 may have allocated too much
    if (avgHeapRatio < 0.3) {
      const avgHeapTotal = mean(metrics.map((m) => m.heapTotal));
      const avgHeapUsed = mean(metrics.map((m) => m.heapUsed));
      insights.push({
        id: generateInsightId(),
        type: 'heap-fragmentation',
        title: 'Low Heap Utilization',
        description: `Only ${(avgHeapRatio * 100).toFixed(0)}% of the allocated heap is being used (${(avgHeapUsed / 1024 / 1024).toFixed(0)}MB used of ${(avgHeapTotal / 1024 / 1024).toFixed(0)}MB total).`,
        severity: 'low',
        processId,
        recommendation:
          'V8 has allocated more heap than needed. This may indicate fragmentation or past memory pressure. Consider restarting the process periodically to reclaim heap space.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    // If heap is nearly full
    if (avgHeapRatio > 0.9) {
      insights.push({
        id: generateInsightId(),
        type: 'heap-pressure',
        title: 'High Heap Pressure',
        description: `Heap utilization is at ${(avgHeapRatio * 100).toFixed(0)}%, indicating the process is near its memory limit.`,
        severity: 'high',
        processId,
        recommendation:
          'The V8 heap is nearly full. Increase --max-old-space-size or reduce memory usage to prevent OOM crashes.',
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return insights;
  }
}
