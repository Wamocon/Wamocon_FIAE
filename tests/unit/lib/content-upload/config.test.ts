import {
  LIMITS,
  evaluateAvailability,
  contentUploadAvailability,
} from '@/lib/content-upload/config';

describe('evaluateAvailability: the content upload is off in Production', () => {
  it('is on in a Vercel preview build on the Preview schema', () => {
    expect(
      evaluateAvailability({
        vercelEnv: 'preview',
        nodeEnv: 'production',
        previewSchema: true,
      })
    ).toEqual({ enabled: true });
  });

  it('is off in a Vercel preview build on another schema', () => {
    expect(
      evaluateAvailability({
        vercelEnv: 'preview',
        nodeEnv: 'production',
        previewSchema: false,
      })
    ).toEqual({ enabled: false, reason: 'PREVIEW_SCHEMA_MISSING' });
  });

  it.each(['production', 'PRODUCTION', ' production ', 'staging', 'x'])(
    'is off for VERCEL_ENV=%j',
    vercelEnv => {
      expect(
        evaluateAvailability({ vercelEnv, nodeEnv: 'development' })
      ).toEqual({ enabled: false, reason: 'ENVIRONMENT' });
      expect(
        evaluateAvailability({
          vercelEnv,
          nodeEnv: 'production',
          previewSchema: true,
        })
      ).toEqual({ enabled: false, reason: 'ENVIRONMENT' });
    }
  );

  it('is on locally: no VERCEL_ENV and not a production build', () => {
    expect(evaluateAvailability({ nodeEnv: 'development' })).toEqual({
      enabled: true,
    });
    expect(evaluateAvailability({ nodeEnv: 'test' })).toEqual({
      enabled: true,
    });
    expect(evaluateAvailability({})).toEqual({ enabled: true });
    expect(evaluateAvailability({ vercelEnv: '', nodeEnv: 'test' })).toEqual({
      enabled: true,
    });
    expect(evaluateAvailability({ vercelEnv: 'development' })).toEqual({
      enabled: true,
    });
  });

  it('is off in a production build without VERCEL_ENV (Docker, next start)', () => {
    expect(evaluateAvailability({ nodeEnv: 'production' })).toEqual({
      enabled: false,
      reason: 'PRODUCTION_BUILD',
    });
    expect(
      evaluateAvailability({ vercelEnv: '  ', nodeEnv: ' Production ' })
    ).toEqual({ enabled: false, reason: 'PRODUCTION_BUILD' });
  });

  it('reads the real environment', () => {
    const before = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = 'production';
      expect(contentUploadAvailability().enabled).toBe(false);
      delete process.env.VERCEL_ENV;
      expect(contentUploadAvailability().enabled).toBe(true);
    } finally {
      if (before === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before;
    }
  });
});

describe('LIMITS follow section 4.5 of the concept', () => {
  it('has the agreed values', () => {
    expect(LIMITS.maxFileBytes).toBe(25 * 1024 * 1024);
    expect(LIMITS.maxFilesPerRun).toBe(1500);
    expect(LIMITS.maxRunBytes).toBe(1024 ** 3);
    expect(LIMITS.maxStagingBytes).toBe(2 * 1024 ** 3);
    expect(LIMITS.stagingWarnRatio).toBe(0.8);
    expect(LIMITS.maxActiveRunsPerPerson).toBe(3);
    expect(LIMITS.maxFilesPerRequest).toBe(50);
    expect(LIMITS.signedUrlRequestsPerWindow).toBe(60);
    expect(LIMITS.expireAfterHours).toBe(24);
    expect(LIMITS.orphanRunDays).toBe(30);
    expect(LIMITS.appliedFilesDays).toBe(30);
    expect(LIMITS.orphanObjectMinAgeDays).toBe(7);
    expect(LIMITS.discardedRowsDays).toBe(7);
  });
});
