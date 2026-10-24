import { describe, it, expect } from '@jest/globals';
import {
  SEATS_FULL,
  checkSeatAvailable,
  seatKindOfRole,
  seatNeededFor,
  seatsFullBody,
  tallySeats,
} from '@/lib/admin/seatRules';

// The seat rules are pure. They decide which role takes which kind of seat,
// when an organization is full and which change of a user needs a free seat.
// The organization list shows the same counts (tallySeats), so display and
// enforcement cannot drift apart.

const usage = (overrides: Record<string, number> = {}) => ({
  trainees: 3,
  trainers: 1,
  maxTraineeSeats: 5,
  maxTrainerSeats: 2,
  ...overrides,
});

describe('seatKindOfRole', () => {
  it('a trainee takes a trainee seat', () => {
    expect(seatKindOfRole('TRAINEE')).toBe('trainee');
    expect(seatKindOfRole('trainee')).toBe('trainee');
  });

  it.each(['TRAINER', 'TEMP_ADMIN', 'ADMIN', 'SUPER_ADMIN'])(
    '%s takes a trainer seat (as the organization list counts it)',
    role => {
      expect(seatKindOfRole(role)).toBe('trainer');
    }
  );

  it('unknown or missing roles take no seat', () => {
    expect(seatKindOfRole('ROOT')).toBeNull();
    expect(seatKindOfRole('')).toBeNull();
    expect(seatKindOfRole(null)).toBeNull();
    expect(seatKindOfRole(undefined)).toBeNull();
  });
});

describe('tallySeats', () => {
  it('adds the counts per seat kind and ignores other roles', () => {
    expect(
      tallySeats([
        { role: 'TRAINEE', count: 4 },
        { role: 'TRAINER', count: 2 },
        { role: 'ADMIN', count: 1 },
        { role: 'TEMP_ADMIN', count: 1 },
        { role: 'SUPER_ADMIN', count: 1 },
        { role: 'ROOT', count: 9 },
      ])
    ).toEqual({ trainees: 4, trainers: 5 });
  });

  it('accepts counts that arrive as text and is empty without rows', () => {
    expect(tallySeats([{ role: 'TRAINEE', count: '7' }])).toEqual({
      trainees: 7,
      trainers: 0,
    });
    expect(tallySeats([])).toEqual({ trainees: 0, trainers: 0 });
  });
});

describe('checkSeatAvailable', () => {
  it('is ok while the occupied seats are below the limit', () => {
    expect(checkSeatAvailable(usage(), 'trainee')).toEqual({ ok: true });
    expect(checkSeatAvailable(usage(), 'trainer')).toEqual({ ok: true });
    expect(checkSeatAvailable(usage({ trainees: 4 }), 'trainee')).toEqual({
      ok: true,
    });
  });

  it('answers 409 SEATS_FULL with occupied and limit when the last seat is taken', () => {
    expect(checkSeatAvailable(usage({ trainees: 5 }), 'trainee')).toEqual({
      ok: false,
      status: 409,
      code: SEATS_FULL,
      kind: 'trainee',
      occupied: 5,
      limit: 5,
    });
    expect(checkSeatAvailable(usage({ trainers: 2 }), 'trainer')).toMatchObject(
      { ok: false, kind: 'trainer', occupied: 2, limit: 2 }
    );
  });

  it('the two kinds are counted apart: full trainees leave trainer seats free', () => {
    const full = usage({ trainees: 5 });
    expect(checkSeatAvailable(full, 'trainee').ok).toBe(false);
    expect(checkSeatAvailable(full, 'trainer').ok).toBe(true);
  });

  it('an organization that is already over its limit blocks new seats, nothing else', () => {
    const over = usage({ trainees: 9, maxTraineeSeats: 5 });
    expect(checkSeatAvailable(over, 'trainee')).toMatchObject({
      ok: false,
      occupied: 9,
      limit: 5,
    });
  });

  it('a limit of zero means no seat at all', () => {
    expect(
      checkSeatAvailable(usage({ trainers: 0, maxTrainerSeats: 0 }), 'trainer')
        .ok
    ).toBe(false);
  });
});

describe('seatNeededFor', () => {
  const ORG = 'org-1';
  const OTHER = 'org-2';

  it('a new user needs a seat of the kind of the role', () => {
    expect(
      seatNeededFor(null, { role: 'TRAINEE', organizationId: ORG })
    ).toEqual({ organizationId: ORG, kind: 'trainee' });
    expect(
      seatNeededFor(null, { role: 'TEMP_ADMIN', organizationId: ORG })
    ).toEqual({ organizationId: ORG, kind: 'trainer' });
  });

  it('a user without an organization needs no seat', () => {
    expect(
      seatNeededFor(null, { role: 'TRAINEE', organizationId: null })
    ).toBeNull();
    expect(
      seatNeededFor(
        { role: 'TRAINEE', organizationId: ORG },
        { role: 'TRAINEE', organizationId: null }
      )
    ).toBeNull();
  });

  it('a role change to the other kind needs a seat of the new kind', () => {
    expect(
      seatNeededFor(
        { role: 'TRAINEE', organizationId: ORG },
        { role: 'TRAINER', organizationId: ORG }
      )
    ).toEqual({ organizationId: ORG, kind: 'trainer' });
    expect(
      seatNeededFor(
        { role: 'TRAINER', organizationId: ORG },
        { role: 'TRAINEE', organizationId: ORG }
      )
    ).toEqual({ organizationId: ORG, kind: 'trainee' });
  });

  it('a change inside one kind keeps its seat and needs nothing', () => {
    for (const [from, to] of [
      ['TRAINER', 'TEMP_ADMIN'],
      ['TEMP_ADMIN', 'ADMIN'],
      ['ADMIN', 'TRAINER'],
      ['TRAINEE', 'TRAINEE'],
    ]) {
      expect(
        seatNeededFor(
          { role: from, organizationId: ORG },
          { role: to, organizationId: ORG }
        )
      ).toBeNull();
    }
  });

  it('moving to another organization needs a seat there, also for the same role', () => {
    expect(
      seatNeededFor(
        { role: 'TRAINEE', organizationId: ORG },
        { role: 'TRAINEE', organizationId: OTHER }
      )
    ).toEqual({ organizationId: OTHER, kind: 'trainee' });
    expect(
      seatNeededFor(
        { role: 'TRAINER', organizationId: null },
        { role: 'TRAINER', organizationId: OTHER }
      )
    ).toEqual({ organizationId: OTHER, kind: 'trainer' });
  });

  it('an unknown role needs no seat', () => {
    expect(
      seatNeededFor(null, { role: 'ROOT', organizationId: ORG })
    ).toBeNull();
  });
});

describe('seatsFullBody', () => {
  it('names the kind, the numbers and the way out in English text with a stable code', () => {
    const body = seatsFullBody({
      ok: false,
      status: 409,
      code: 'SEATS_FULL',
      kind: 'trainee',
      occupied: 12,
      limit: 12,
    });
    expect(body).toMatchObject({
      code: 'SEATS_FULL',
      kind: 'trainee',
      occupied: 12,
      limit: 12,
    });
    expect(body.error).toMatch(/trainee seats/i);
    expect(body.error).toContain('12 of 12');
    expect(body.error).toMatch(/platform admin/i);
  });

  it('says that admins count as trainers when trainer seats are full', () => {
    const body = seatsFullBody({
      ok: false,
      status: 409,
      code: 'SEATS_FULL',
      kind: 'trainer',
      occupied: 5,
      limit: 5,
    });
    expect(body.error).toMatch(/trainer seats/i);
    expect(body.error).toMatch(/admins/i);
  });
});
