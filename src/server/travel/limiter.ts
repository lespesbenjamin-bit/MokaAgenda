/** Limiteur simple : N requêtes par seconde et nombre maximal d'appels simultanés (par instance serveur). */
export class RateLimiter {
  private timestamps: number[] = [];
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private perSecond: number, private concurrency: number) {}

  private async slot(): Promise<void> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.perSecond) {
        this.timestamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - this.timestamps[0]) + 5));
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.slot();
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** Cache mémoire à durée de vie limitée (par instance serveur). */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private max: number, private ttlMs: number) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }
}
