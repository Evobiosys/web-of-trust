// Clock + Scheduler abstraction — injectable so lifecycle timers (I3 uniform
// STATUS delay) are testable with a fake clock instead of real wall-clock waits.
//
// Design: `Scheduler.schedule` is the ONLY way lifecycle code fires delayed
// work. It never bakes in the outcome of that work — callers compute what to
// send at fire time (see lifecycle/owner.ts), which is what makes I3's
// byte-identical PASS possible: the timer fires on schedule regardless of
// whether the owner already declined, matched, or found nothing.
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface Scheduler {
  /** Schedule `fn` to run at `atIso` (an ISO-8601 timestamp, e.g. from statusDispatchAt). */
  scheduleAt(atIso: string, fn: () => void | Promise<void>): void;
}

/**
 * Real scheduler: uses the injected Clock to compute the delay from "now" to
 * the target time, then a real `setTimeout`. In production this clock is a
 * SystemClock; in tests it never runs (FakeScheduler is used instead).
 */
export class RealScheduler implements Scheduler {
  constructor(private readonly clock: Clock) {}

  scheduleAt(atIso: string, fn: () => void | Promise<void>): void {
    const delayMs = Math.max(0, new Date(atIso).getTime() - this.clock.now().getTime());
    setTimeout(() => {
      void fn();
    }, delayMs);
  }
}

interface PendingTask {
  atMs: number;
  fn: () => void | Promise<void>;
  seq: number;
}

/**
 * Fake clock + scheduler pair for tests. `advance(ms)` moves time forward and
 * synchronously (but awaitably, since task fns may be async) fires every task
 * whose scheduled time has been reached, in (time, insertion-order) order.
 */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(startIso: string) {
    this.currentMs = new Date(startIso).getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  /** Used by FakeScheduler only. */
  _advanceTo(ms: number): void {
    this.currentMs = ms;
  }

  _currentMs(): number {
    return this.currentMs;
  }
}

export class FakeScheduler implements Scheduler {
  private readonly tasks: PendingTask[] = [];
  private seq = 0;

  constructor(private readonly clock: FakeClock) {}

  scheduleAt(atIso: string, fn: () => void | Promise<void>): void {
    this.tasks.push({ atMs: new Date(atIso).getTime(), fn, seq: this.seq++ });
  }

  /** Advance fake time by `ms`, running every task due at or before the new time. */
  async advance(ms: number): Promise<void> {
    const target = this.clock._currentMs() + ms;
    // Run tasks in due-time order; ties broken by schedule order. Tasks
    // scheduled BY a running task (e.g. chained follow-ups) are eligible if
    // their due time still falls within this advance.
    for (;;) {
      const due = this.tasks
        .filter((t) => t.atMs <= target)
        .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq)[0];
      if (!due) break;
      this.tasks.splice(this.tasks.indexOf(due), 1);
      this.clock._advanceTo(due.atMs);
      await due.fn();
    }
    this.clock._advanceTo(target);
  }

  pendingCount(): number {
    return this.tasks.length;
  }
}
