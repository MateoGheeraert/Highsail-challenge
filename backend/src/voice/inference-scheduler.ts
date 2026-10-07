/** One request in flight, one newest pending input. No unbounded request queue. */
export class InferenceScheduler<T, R> {
  private latest?: { revision: number; input: T };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private attempted = -1;
  private applied = -1;
  private lastStarted = 0;
  private pendingSince?: number;
  private lastRequested = 0;
  private closed = false;
  private flushing = false;
  private error: unknown;

  constructor(
    private readonly infer: (input: T) => Promise<R>,
    private readonly publish: (result: R, revision: number) => void,
    private readonly failed: (error: unknown) => void,
    private readonly interval = 1000,
  ) {}

  request(revision: number, input: T) {
    if (this.closed || (this.latest && revision <= this.latest.revision))
      return;
    const now = Date.now();
    this.pendingSince ??= now;
    this.lastRequested = now;
    this.latest = { revision, input };
    clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule();
  }

  private schedule() {
    if (
      this.closed ||
      this.flushing ||
      this.running ||
      this.timer ||
      !this.latest ||
      this.latest.revision <= this.attempted
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.run();
      },
      // Wait briefly for a partial phrase to settle, but keep previewing during
      // continuous speech. Never postpone beyond one interval of queued input.
      Math.max(
        0,
        Math.max(
          this.lastStarted + this.interval,
          Math.min(
            this.lastRequested + Math.min(350, this.interval),
            (this.pendingSince ?? Date.now()) + this.interval,
          ),
        ) - Date.now(),
      ),
    );
  }

  private run(): Promise<void> {
    if (this.closed || !this.latest) return Promise.resolve();
    const current = this.latest;
    this.pendingSince = undefined;
    this.attempted = current.revision;
    this.lastStarted = Date.now();
    this.running = (async () => {
      try {
        const result = await this.infer(current.input);
        if (!this.closed && current.revision > this.applied) {
          this.publish(result, current.revision);
          this.applied = current.revision;
          this.error = undefined;
        }
      } catch (error) {
        this.error = error;
        // A newer transcript is already queued to replace this incomplete one.
        // Keep the last valid preview and let that request recover quietly.
        if (!this.closed && current.revision === this.latest?.revision)
          this.failed(error);
      }
    })().finally(() => {
      this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  async flush() {
    this.flushing = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      await this.running;
      if (!this.closed && this.latest && this.applied !== this.latest.revision)
        await this.run();
      if (this.closed) throw new Error("Voice session ended.");
      if (this.error) throw this.error;
    } finally {
      this.flushing = false;
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }
}
