/**
 * Calculate the proposals for the shared HAI memory.
 *
 * POST /api/admin/hai/memory/suggest -> { created, updated, kept, k }
 *
 * Only the platform admin (requireSuperAdmin). The calculation is deterministic and
 * has no reference to a person: it counts DIFFERENT users per occupation and key
 * (a preference that at least k users confirmed, a topic in which at least k users
 * struggle in the quizzes), the database applies the minimum k (HAVING) so a
 * smaller count never leaves it, and the text comes from fixed templates. The
 * answer contains numbers only. A proposal is only a proposal: it acts after an
 * admin approved it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireSuperAdmin } from '@/lib/auth/session';
import { GLOBAL_MIN_SUPPORT_K } from '@/lib/hai/memory/config';
import {
  loadPreferenceCounters,
  loadWeaknessCounters,
} from '@/lib/hai/memory/globalData';
import { buildGlobalProposals } from '@/lib/hai/memory/globalPropose';
import { storeGlobalProposals } from '@/lib/hai/memory/globalStore';
import { dbGlobalMemoryRepo } from '@/lib/hai/memory/repoDb';
import { PRIVATE, memoryOffResponse } from '@/lib/hai/memory/routeHelpers';

export async function POST(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;
  const off = memoryOffResponse();
  if (off) return off;

  try {
    const k = GLOBAL_MIN_SUPPORT_K;
    const [preferences, weaknesses] = await Promise.all([
      loadPreferenceCounters(k),
      loadWeaknessCounters(k),
    ]);
    const proposals = buildGlobalProposals(preferences, weaknesses, k);
    const summary = await storeGlobalProposals(dbGlobalMemoryRepo, proposals);
    return NextResponse.json({ ...summary, k }, { headers: PRIVATE });
  } catch (error) {
    console.error(
      'HAI memory admin: calculation failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Proposals could not be calculated', code: 'CALC_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}
