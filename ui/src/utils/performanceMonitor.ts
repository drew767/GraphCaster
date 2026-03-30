// Copyright GraphCaster. All Rights Reserved.

class CircularBuffer {
  private buffer: number[];
  private index = 0;
  private count = 0;

  constructor(private size: number) {
    this.buffer = new Array(size).fill(0);
  }

  push(value: number): void {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }

  getValues(): number[] {
    if (this.count < this.size) {
      return this.buffer.slice(0, this.count);
    }
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }

  clear(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
  }
}

export class FPSCounter {
  private frameTimes: CircularBuffer;
  private lastFrameTime = 0;

  constructor(sampleSize = 60) {
    this.frameTimes = new CircularBuffer(sampleSize);
  }

  recordFrame(timestamp = performance.now()): void {
    if (this.lastFrameTime > 0) {
      const delta = timestamp - this.lastFrameTime;
      this.frameTimes.push(delta);
    }
    this.lastFrameTime = timestamp;
  }

  getFPS(): number {
    const times = this.frameTimes.getValues();
    if (times.length < 2) {
      return 0;
    }

    const avgFrameTime = times.reduce((a, b) => a + b, 0) / times.length;
    return avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
  }

  reset(): void {
    this.frameTimes.clear();
    this.lastFrameTime = 0;
  }
}

export class RenderTracker {
  private counts = new Map<string, number>();

  recordRender(componentName: string): void {
    const current = this.counts.get(componentName) || 0;
    this.counts.set(componentName, current + 1);
  }

  getRenderCount(componentName: string): number {
    return this.counts.get(componentName) || 0;
  }

  getAllCounts(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  reset(): void {
    this.counts.clear();
  }
}

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  renderCounts: Record<string, number>;
  nodeCount: number;
  edgeCount: number;
  visibleNodeCount: number;
}

export class PerformanceMonitor {
  private fpsCounter = new FPSCounter();
  private renderTracker = new RenderTracker();
  private frameStart = 0;
  private lastFrameTime = 0;

  nodeCount = 0;
  edgeCount = 0;
  visibleNodeCount = 0;

  startFrame(): void {
    this.frameStart = performance.now();
  }

  endFrame(): void {
    const now = performance.now();
    this.lastFrameTime = now - this.frameStart;
    this.fpsCounter.recordFrame(now);
  }

  recordRender(componentName: string): void {
    this.renderTracker.recordRender(componentName);
  }

  getMetrics(): PerformanceMetrics {
    return {
      fps: Math.round(this.fpsCounter.getFPS()),
      frameTime: Math.round(this.lastFrameTime * 100) / 100,
      renderCounts: this.renderTracker.getAllCounts(),
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount,
      visibleNodeCount: this.visibleNodeCount,
    };
  }

  reset(): void {
    this.fpsCounter.reset();
    this.renderTracker.reset();
  }
}

export const performanceMonitor = new PerformanceMonitor();
