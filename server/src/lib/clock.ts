export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Controllable clock for tests. */
export class ManualClock implements Clock {
  constructor(private t: number = Date.parse('2026-01-05T10:00:00Z')) {}
  now() {
    return new Date(this.t);
  }
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
  set(d: Date) {
    this.t = d.getTime();
  }
}
