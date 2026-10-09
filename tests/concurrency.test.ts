import { describe, expect, it } from "bun:test";
import { AsyncMutex, LockAcquisitionTimeoutError } from "../src/core/concurrency.js";

describe("AsyncMutex", () => {
  it("executes critical sections in FIFO order", async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((id) =>
      mutex.runExclusive(async () => {
        // Yield to microtask queue deterministically without wall-clock sleep
        await Promise.resolve();
        order.push(id);
      })
    );

    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(mutex.isLocked).toBe(false);
    expect(mutex.queueLength).toBe(0);
  });

  it("times out if lock is not acquired in time", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();

    expect(mutex.isLocked).toBe(true);

    // Timeout is tested with minimal 1ms deadline
    let errorCaught = false;
    try {
      await mutex.acquire(1);
    } catch (err) {
      if (err instanceof LockAcquisitionTimeoutError) {
        errorCaught = true;
      }
    }

    expect(errorCaught).toBe(true);
    release();
    expect(mutex.isLocked).toBe(false);
  });
});
