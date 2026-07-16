import { promises as fs } from "node:fs";
import path from "node:path";

const LOCK_POLL_INTERVAL_MS = 25;
const LOCK_FILE_NAME = "kherad-write.lock";

/**
 * In-process serialization: a simple promise chain. Guarantees at most one
 * write callback runs at a time within this Node process.
 */
class InProcessMutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Cross-process serialization via atomic exclusive file creation (`O_EXCL`).
 * This gives the same kernel-enforced mutual-exclusion guarantee as flock(2)
 * without requiring a native addon: two processes racing to `open(path, "wx")`
 * are guaranteed by the OS to have exactly one of them succeed.
 */
async function acquireDirectoryLock(
  gitdir: string,
  timeoutMs: number,
): Promise<() => Promise<void>> {
  const lockPath = path.join(gitdir, LOCK_FILE_NAME);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close();
        await fs.unlink(lockPath).catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for git write lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
    }
  }
}

export type WithWriteLock = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Two-layer write lock for a single bare repo, per PRD §8:
 *  1. an in-process async mutex/queue
 *  2. an OS-level lock on the repo directory (protects against a second writer process)
 */
export function createWriteLock(gitdir: string, opts?: { timeoutMs?: number }): WithWriteLock {
  const mutex = new InProcessMutex();
  const timeoutMs = opts?.timeoutMs ?? 10_000;

  return function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return mutex.run(async () => {
      const release = await acquireDirectoryLock(gitdir, timeoutMs);
      try {
        return await fn();
      } finally {
        await release();
      }
    });
  };
}
