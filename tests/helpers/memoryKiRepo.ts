// KiRepo in memory, for the unit tests. It follows the rules of the SQL
// implementation (src/lib/content-upload/ki/repo-pg.ts), held to them by the same
// contract test (tests/unit/lib/content-upload/ki-repo-contract.ts).

import {
  CALL_STATUSES,
  type KiCallStatus,
  type KiCallWrite,
  type KiRepo,
  type KiUsage,
} from '@/lib/content-upload/ki/repo';

export interface StoredCall extends KiCallWrite {
  requestedAtMs: number;
}

export class MemoryKiRepo implements KiRepo {
  calls: StoredCall[] = [];

  constructor(private readonly nowMs: () => number) {}

  async recordCall(call: KiCallWrite): Promise<void> {
    await Promise.resolve();
    this.calls.push({ ...call, requestedAtMs: this.nowMs() });
  }

  async usage(
    runId: string,
    fileId: string | null,
    recentLimit: number
  ): Promise<KiUsage> {
    await Promise.resolve();
    const reached = this.calls.filter(c =>
      (CALL_STATUSES as readonly string[]).includes(c.status)
    );
    const now = this.nowMs();
    const day = 24 * 3_600_000;
    const recent = reached
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => c.runId === runId)
      // newest first, and the later row first when two share a millisecond
      .sort(
        (a, b) => b.c.requestedAtMs - a.c.requestedAtMs || b.index - a.index
      )
      .slice(0, Math.max(0, recentLimit))
      .map(({ c }) => ({
        status: c.status as KiCallStatus,
        ageSec: Math.max(0, (now - c.requestedAtMs) / 1000),
      }));
    return {
      run: reached.filter(c => c.runId === runId).length,
      day: reached.filter(c => now - c.requestedAtMs <= day).length,
      file:
        fileId === null ? 0 : reached.filter(c => c.fileId === fileId).length,
      recent,
    };
  }
}
