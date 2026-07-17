import { describe, expect, it } from "vitest";
import { FakeClock, FakeScheduler } from "./clock.js";

describe("FakeClock + FakeScheduler", () => {
  it("does not fire a task before its scheduled time", async () => {
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const scheduler = new FakeScheduler(clock);
    let fired = false;
    scheduler.scheduleAt("2026-01-01T00:00:02.000Z", () => {
      fired = true;
    });
    await scheduler.advance(1000);
    expect(fired).toBe(false);
    expect(clock.nowIso()).toBe("2026-01-01T00:00:01.000Z");
  });

  it("fires a task exactly at its scheduled time", async () => {
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const scheduler = new FakeScheduler(clock);
    let firedAt: string | undefined;
    scheduler.scheduleAt("2026-01-01T00:00:02.000Z", () => {
      firedAt = clock.nowIso();
    });
    await scheduler.advance(2000);
    expect(firedAt).toBe("2026-01-01T00:00:02.000Z");
  });

  it("fires multiple tasks due within the same advance, in time then insertion order", async () => {
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const scheduler = new FakeScheduler(clock);
    const order: string[] = [];
    scheduler.scheduleAt("2026-01-01T00:00:02.000Z", () => {
      order.push("second-scheduled-but-later");
    });
    scheduler.scheduleAt("2026-01-01T00:00:01.000Z", () => {
      order.push("first-scheduled-and-earlier");
    });
    scheduler.scheduleAt("2026-01-01T00:00:01.000Z", () => {
      order.push("third-scheduled-same-time");
    });
    await scheduler.advance(5000);
    expect(order).toEqual(["first-scheduled-and-earlier", "third-scheduled-same-time", "second-scheduled-but-later"]);
  });

  it("supports async task fns and awaits them before continuing", async () => {
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const scheduler = new FakeScheduler(clock);
    const log: string[] = [];
    scheduler.scheduleAt("2026-01-01T00:00:01.000Z", async () => {
      log.push("start");
      await Promise.resolve();
      log.push("end");
    });
    await scheduler.advance(1000);
    expect(log).toEqual(["start", "end"]);
  });

  it("leaves no pending tasks once their time has passed", async () => {
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const scheduler = new FakeScheduler(clock);
    scheduler.scheduleAt("2026-01-01T00:00:01.000Z", () => {});
    expect(scheduler.pendingCount()).toBe(1);
    await scheduler.advance(1000);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
