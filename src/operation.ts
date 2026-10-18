import { performance } from "node:perf_hooks";

export const maxTimeoutMs = 120_000;

export class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Browser operation timed out after ${timeoutMs}ms.`);
    this.name = "TimeoutError";
  }
}

/** A single budget covers DNS, launch, navigation and extraction. Resources
 * acquired after cancellation are disposed rather than escaping ownership. */
export class Operation {
  private readonly controller = new AbortController();
  private readonly deadline: number;
  private readonly timer: NodeJS.Timeout;
  private readonly disposers: Array<() => Promise<void>> = [];
  private disposed = false;
  private readonly onCancel = () => this.controller.abort(
    this.externalSignal?.reason ?? new Error("Browser request was canceled."),
  );

  constructor(timeoutMs: number, private readonly externalSignal?: AbortSignal) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxTimeoutMs) {
      throw new Error(`timeoutMs must be an integer from 1 to ${maxTimeoutMs}.`);
    }
    this.deadline = performance.now() + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(new OperationTimeoutError(timeoutMs)), timeoutMs);
    externalSignal?.addEventListener("abort", this.onCancel, { once: true });
    if (externalSignal?.aborted) this.onCancel();
  }

  get signal(): AbortSignal { return this.controller.signal; }

  remainingMs(): number {
    this.signal.throwIfAborted();
    return Math.max(1, Math.ceil(this.deadline - performance.now()));
  }

  wait<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.signal.removeEventListener("abort", abort);
        reject(this.signal.reason);
      };
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      // Always attach handlers, even when already aborted, to observe late
      // rejection from operations (such as DNS) without cancellation APIs.
      promise.then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
    });
  }

  acquire<T>(promise: Promise<T>, dispose: (resource: T) => Promise<void>): Promise<T> {
    return this.wait(promise.then(async (resource) => {
      if (this.signal.aborted || this.disposed) {
        await dispose(resource);
        throw this.signal.reason;
      }
      this.disposers.push(() => dispose(resource));
      return resource;
    }));
  }

  async close(): Promise<void> {
    this.disposed = true;
    clearTimeout(this.timer);
    this.externalSignal?.removeEventListener("abort", this.onCancel);
    this.controller.abort(new Error("Browser operation is closed."));
    // Close the browser before its network proxy. Try every disposer even if
    // one fails, and make failed cleanup visible to the caller.
    const errors: unknown[] = [];
    for (const dispose of this.disposers.reverse()) {
      try { await dispose(); } catch (cause) { errors.push(cause); }
    }
    if (errors.length > 0) throw new Error("Could not clean up browser resources.");
  }
}
