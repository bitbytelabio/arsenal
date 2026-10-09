/**
 * Concurrency & Mutex Primitives
 * Implements data-model.md §2 and contracts/ledger-concurrency.md
 * Provides thread-safe FIFO AsyncMutex and FileLock for serializing
 * asynchronous and process-level file writes with timeout fallback.
 */

import * as fs from "node:fs";

export type TransactionStatus = "queued" | "acquiring" | "active" | "committed" | "failed";

export interface QueuedTransaction {
  transactionId: string;
  queuedAt: number;
  status: TransactionStatus;
  eventKey: string;
  entityPrefix: string;
  allocatedSeq?: number;
  headPrevHash?: string;
  recordSha256?: string;
  error?: string;
}

export interface LedgerCommitLock {
  transactionId: string;
  acquiredAt: number;
  release: () => void;
}

export class LockAcquisitionTimeoutError extends Error {
  constructor(message: string = "Lock acquisition timed out") {
    super(message);
    this.name = "LockAcquisitionTimeoutError";
  }
}

export interface Lock {
  acquire(timeoutMs?: number): Promise<() => void>;
  runExclusive<T>(fn: () => Promise<T> | T, timeoutMs?: number): Promise<T>;
  readonly isLocked: boolean;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Thread-safe FIFO asynchronous mutex.
 * Guarantees that callers acquire the lock in exact request order.
 */
export class AsyncMutex implements Lock {
  private locked = false;
  private queue: Waiter[] = [];

  public get isLocked(): boolean {
    return this.locked;
  }

  public get queueLength(): number {
    return this.queue.length;
  }

  public acquire(timeoutMs?: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.createRelease());
    }

    const { promise, resolve, reject } = Promise.withResolvers<() => void>();
    const waiter: Waiter = { resolve, reject };

    if (timeoutMs !== undefined && timeoutMs > 0) {
      waiter.timer = setTimeout(() => {
        const idx = this.queue.indexOf(waiter);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new LockAcquisitionTimeoutError(`Timed out waiting for lock after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    }

    this.queue.push(waiter);
    return promise;
  }

  public async runExclusive<T>(fn: () => Promise<T> | T, timeoutMs?: number): Promise<T> {
    const release = await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.createRelease());
      } else {
        this.locked = false;
      }
    };
  }
}

/**
 * File-based lock for cross-process synchronization.
 * Uses atomic file creation (O_CREAT | O_EXCL) with retry loop and timeout fallback.
 */
export class FileLock implements Lock {
  private readonly lockFilePath: string;
  private fd: number | null = null;

  constructor(targetFilePath: string) {
    this.lockFilePath = `${targetFilePath}.lock`;
  }

  public get isLocked(): boolean {
    return this.fd !== null || fs.existsSync(this.lockFilePath);
  }

  public async acquire(timeoutMs: number = 10_000): Promise<() => void> {
    const startTime = Date.now();
    const pollIntervalMs = 25;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // 'wx' flag opens for writing with O_CREAT | O_EXCL (fails if file exists)
        this.fd = fs.openSync(this.lockFilePath, "wx");
        fs.writeSync(this.fd, `${process.pid}\n${Date.now()}`);
        return this.createRelease();
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "EEXIST") {
          // Lock is held by another process; check for stale lock (> 30s)
          try {
            const stats = fs.statSync(this.lockFilePath);
            if (Date.now() - stats.mtimeMs > 30_000) {
              try {
                fs.unlinkSync(this.lockFilePath);
              } catch {
                // Another process might have cleaned it up
              }
            }
          } catch {
            // Stat failed; retry
          }
          const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
          setTimeout(delayResolve, pollIntervalMs);
          await delayPromise;
        } else {
          throw err;
        }
      }
    }

    throw new LockAcquisitionTimeoutError(
      `Failed to acquire file lock on ${this.lockFilePath} within ${timeoutMs}ms`
    );
  }

  public async runExclusive<T>(fn: () => Promise<T> | T, timeoutMs?: number): Promise<T> {
    const release = await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.fd !== null) {
        try {
          fs.closeSync(this.fd);
        } catch {
          // Ignore
        }
        this.fd = null;
      }
      try {
        if (fs.existsSync(this.lockFilePath)) {
          fs.unlinkSync(this.lockFilePath);
        }
      } catch {
        // Ignore unlink failure on cleanup
      }
    };
  }
}
