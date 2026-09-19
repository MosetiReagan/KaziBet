export class MetricCollector {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  public increment(metricName: string, value = 1): void {
    const current = this.counters.get(metricName) ?? 0;
    this.counters.set(metricName, current + value);
  }

  public recordLatency(metricName: string, durationMs: number): void {
    if (!this.histograms.has(metricName)) {
      this.histograms.set(metricName, []);
    }
    this.histograms.get(metricName)!.push(durationMs);
  }

  public getCounter(metricName: string): number {
    return this.counters.get(metricName) ?? 0;
  }

  public getLatencyStats(metricName: string): { count: number; avgMs: number; p95Ms: number } {
    const values = this.histograms.get(metricName) || [];
    if (values.length === 0) return { count: 0, avgMs: 0, p95Ms: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avgMs = sum / sorted.length;
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p95Ms = sorted[p95Idx] ?? sorted[sorted.length - 1]!;

    return {
      count: sorted.length,
      avgMs: parseFloat(avgMs.toFixed(2)),
      p95Ms: parseFloat(p95Ms.toFixed(2))
    };
  }

  public exportPrometheusFormat(): string {
    let output = '';
    for (const [name, val] of this.counters.entries()) {
      output += `# TYPE ${name} counter\n${name} ${val}\n`;
    }
    for (const [name, vals] of this.histograms.entries()) {
      const stats = this.getLatencyStats(name);
      output += `# TYPE ${name}_ms summary\n${name}_avg_ms ${stats.avgMs}\n${name}_p95_ms ${stats.p95Ms}\n`;
    }
    return output;
  }
}
