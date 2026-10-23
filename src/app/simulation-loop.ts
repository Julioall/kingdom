export class SimulationClock {
  private previous: number | null = null;
  private accumulated = 0;
  reset() { this.previous = null; this.accumulated = 0; }
  advance(now: number, paused: boolean, speed: number): number {
    const elapsed = this.previous === null ? 0 : Math.max(0, Math.min(.25, (now - this.previous) / 1000));
    this.previous = now;
    if (paused) return 0;
    this.accumulated += elapsed * speed;
    const days = Math.min(12, Math.floor(this.accumulated));
    this.accumulated -= days;
    return days;
  }
}
