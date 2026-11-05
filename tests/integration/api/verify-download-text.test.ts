/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createTableDb } from '../../helpers/mockDb';

// The download of a certificate by its verification code writes a closing
// sentence when the snapshot has none. It used to read "Person Leon Moretz hat
// die ihm übertragenen Aufgaben": a name with "Person" and a pronoun of one
// gender. It now names the person and uses no pronoun.

const CODE = 'abc123';

async function download(snapshot: Record<string, unknown>, gender: string) {
  jest.resetModules();
  const generate = jest.fn(async (_data: any) => new Blob(['pdf']));
  const mock = createTableDb({
    workCertificates: [
      {
        snapshotData: snapshot,
        issueDate: '2026-10-01',
        qrVerificationCode: CODE,
        gender,
        customSummary: null,
        approvedByTrainerId: null,
        traineeId: null,
      },
    ],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/arbeitszeugnis/pdfGenerator', () => ({
    __esModule: true,
    generateArbeitszeugnisPDF: generate,
  }));
  jest.doMock('qrcode', () => ({
    __esModule: true,
    default: { toDataURL: async () => 'data:image/png;base64,AAAA' },
  }));
  jest.doMock('@/lib/storage/contentRead', () => ({
    __esModule: true,
    readContentObject: async () => ({ status: 'missing' }),
  }));
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: false, status: 404 } as any);
  const mod = await import('@/app/api/verify/[code]/download/route');
  const res = await mod.GET(
    {
      url: `http://localhost/api/verify/${CODE}/download`,
      headers: new Headers(),
    } as any,
    { params: Promise.resolve({ code: CODE }) }
  );
  return { res, generate };
}

describe('GET /api/verify/[code]/download: closing sentence without a stored one', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each(['male', 'female', 'neutral'])(
    'names the person and uses no pronoun for a certificate of gender %s',
    async gender => {
      const { res, generate } = await download(
        { traineeName: 'Leon Moretz' },
        gender
      );
      expect(res.status).toBe(200);
      const text = generate.mock.calls[0][0].overallAssessment as string;
      expect(text).toMatch(/^Leon Moretz hat die übertragenen Aufgaben stets/);
      expect(text).not.toMatch(/\b(ihm|ihr|Person)\b/);
    }
  );

  it('keeps a stored closing sentence as it is', async () => {
    const { generate } = await download(
      { traineeName: 'Leon Moretz', overallAssessment: 'Eigener Text.' },
      'male'
    );
    expect(generate.mock.calls[0][0].overallAssessment).toBe('Eigener Text.');
  });
});

describe('the verification route', () => {
  it('has no gendered wording in its text', () => {
    // "die ihm übertragenen" belongs to the template of the generator with a
    // known person (Herr or Frau) only, not to the verification route
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/verify/[code]/download/route.ts'),
      'utf8'
    );
    expect(route).not.toMatch(/ihm übertragen|ihr übertragen|ihm zugewiesen/);
  });
});
