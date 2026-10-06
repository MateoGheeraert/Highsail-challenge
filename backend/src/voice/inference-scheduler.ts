/** One request in flight, one newest pending input. No unbounded request queue. */
export class InferenceScheduler<T, R> {
  private latest?: { revision: number; input: T };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private attempted = -1;
  private applied = -1;
  private lastStarted = 0;
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
    if (this.closed) return;
    this.latest = { revision, input };
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
      Math.max(0, this.interval - (Date.now() - this.lastStarted)),
    );
  }

  private run(): Promise<void> {
    if (this.closed || !this.latest) return Promise.resolve();
    const current = this.latest;
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
        if (!this.closed) this.failed(error);
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
