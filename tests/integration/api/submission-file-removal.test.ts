/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockCatalogScope,
  mockSession,
} from '../../helpers/mockNext';
import {
  PDF_BYTES,
  createMemorySubmissionStorage,
} from '../../helpers/memorySubmissionStorage';
import {
  filePath,
  incomingPath,
  submissionFolder,
} from '@/lib/submission-file/rules';

// The files of the submissions go at once when a trainee (admin route), a use case or a
// course (curriculum routes) is deleted. The files are found before the delete and removed
// after it went through, a delete that fails keeps them, and a storage that fails never
// fails the request (the cleanup run takes what is left).

const ORG = '11111111-1111-4111-8111-111111111111';
const TARGET = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const UC1 = '33333333-3333-4333-8333-333333333331';
const UC2 = '33333333-3333-4333-8333-333333333332';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const COURSE = '55555555-5555-4555-8555-555555555555';

const folderOf = (trainee: string, useCase: string) =>
  submissionFolder(
    { organizationId: ORG, traineeId: trainee, useCaseId: useCase },
    'public'
  ) as string;
const fileOf = (trainee: string, useCase: string) =>
  filePath(folderOf(trainee, useCase), 1761700000000, 'a.pdf');
const uploadOf = (trainee: string, useCase: string) =>
  incomingPath(folderOf(trainee, useCase), `${UPLOAD}.pdf`);

const superAdmin = fakeSession({
  id: '88888888-8888-4888-8888-888888888888',
  role: 'ADMIN',
  organizationId: ORG,
  isAdmin: true,
  isSuperAdmin: true,
});

function seededStorage() {
  const storage = createMemorySubmissionStorage('public');
  // the target trainee: a submitted file, an unfinished upload, a draft without a row
  storage.objects.set(fileOf(TARGET, UC1), PDF_BYTES);
  storage.objects.set(uploadOf(TARGET, UC1), PDF_BYTES);
  storage.objects.set(fileOf(TARGET, UC2), PDF_BYTES);
  // another trainee: the same use case
  storage.objects.set(fileOf(OTHER, UC1), PDF_BYTES);
  return storage;
}

type Setup = {
  tables?: Record<string, any[]>;
  storage: ReturnType<typeof createMemorySubmissionStorage>;
  deleteError?: unknown;
  env?: Record<string, string>;
};

async function load(setup: Setup) {
  jest.resetModules();
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY = 'service-key';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.ADMIN_EMAIL = 'owner@example.com';
  for (const [key, value] of Object.entries(setup.env ?? {})) {
    process.env[key] = value;
  }
  const mock = createTableDb({
    profiles: [
      {
        id: TARGET,
        email: 'target@example.com',
        role: 'TRAINEE',
        organizationId: ORG,
      },
    ],
    useCaseSubmissions: [
      { organizationId: ORG, traineeId: TARGET, useCaseId: UC1 },
      { organizationId: ORG, traineeId: OTHER, useCaseId: UC1 },
    ],
    useCases: [{ id: UC1, courseId: COURSE }],
    courses: [{ id: COURSE, title: 'Course' }],
    courseMembers: [],
    ...(setup.tables ?? {}),
  });
  if (setup.deleteError !== undefined) {
    mock.db.delete = jest.fn(() => ({
      where: () => Promise.reject(setup.deleteError),
    }));
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(superAdmin);
  mockCatalogScope();
  const createSubmissionStorage = jest.fn(() => setup.storage);
  jest.doMock('@/lib/submission-file/storage', () => {
    const actual = jest.requireActual('@/lib/submission-file/storage') as any;
    return { ...actual, createSubmissionStorage };
  });
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      auth: {
        admin: {
          deleteUser: async () => ({ error: null }),
          getUserById: async () => ({
            data: { user: { app_metadata: { preview_only: true } } },
            error: null,
          }),
        },
      },
    }),
  }));
  return { mock, createSubmissionStorage };
}

const savedEnv = { ...process.env };
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...savedEnv } as NodeJS.ProcessEnv;
  jest.restoreAllMocks();
});

const deleteUser = async () => {
  const route = await import('@/app/api/admin/users/[userId]/route');
  return route.DELETE(
    makeRequest('DELETE', `http://localhost/api/admin/users/${TARGET}`, {
      token: 't',
    }),
    { params: Promise.resolve({ userId: TARGET }) } as any
  );
};
const deleteUseCase = async () => {
  const route = await import('@/app/api/trainer/use-cases/[useCaseId]/route');
  return route.DELETE(
    makeRequest('DELETE', `http://localhost/api/trainer/use-cases/${UC1}`, {
      token: 't',
    }),
    { params: Promise.resolve({ useCaseId: UC1 }) } as any
  );
};
const deleteCourse = async () => {
  const route = await import('@/app/api/trainer/courses/[courseId]/route');
  return route.DELETE(
    makeRequest('DELETE', `http://localhost/api/trainer/courses/${COURSE}`, {
      token: 't',
    }),
    { params: Promise.resolve({ courseId: COURSE }) } as any
  );
};

describe('DELETE /api/admin/users/[userId]', () => {
  it('removes every file of the trainee at once: submitted, unfinished and draft', async () => {
    const storage = seededStorage();
    const { mock } = await load({ storage });
    const res = await deleteUser();
    expect(res.status).toBe(200);
    expect([...storage.objects.keys()]).toEqual([fileOf(OTHER, UC1)]);
    // the rows are asked for by the trainee that is deleted (the mock does not filter)
    expect(mock.filters('select', 'use_case_submissions').params).toContain(
      TARGET
    );
  });

  it('keeps the files when the profile cannot be deleted', async () => {
    const storage = seededStorage();
    const before = storage.objects.size;
    await load({ storage, deleteError: { cause: { code: '23503' } } });
    const res = await deleteUser();
    expect(res.status).toBe(409);
    expect(storage.objects.size).toBe(before);
  });

  it('still answers 200 when the storage does not answer', async () => {
    const storage = seededStorage();
    storage.failNext('listFolders');
    storage.failNext('list');
    await load({ storage });
    const res = await deleteUser();
    expect(res.status).toBe(200);
    // the logged text holds no id
    const logged = (console.error as jest.Mock).mock.calls
      .map(call => call.join(' '))
      .join('\n');
    expect(logged).not.toContain(TARGET);
  });

  it('removes what the submission rows name even if the folder listing fails', async () => {
    const storage = seededStorage();
    storage.failNext('listFolders');
    await load({ storage });
    const res = await deleteUser();
    expect(res.status).toBe(200);
    expect(storage.objects.has(fileOf(TARGET, UC1))).toBe(false);
    expect(storage.objects.has(fileOf(OTHER, UC1))).toBe(true);
  });

  it('does not touch the storage where the feature is off (Production)', async () => {
    const storage = seededStorage();
    const before = storage.objects.size;
    const { createSubmissionStorage } = await load({
      storage,
      env: { VERCEL_ENV: 'production' },
    });
    const res = await deleteUser();
    expect(res.status).toBe(200);
    expect(createSubmissionStorage).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(before);
  });

  it('answers 200 when the storage is not configured at all', async () => {
    const storage = seededStorage();
    const { createSubmissionStorage } = await load({ storage });
    createSubmissionStorage.mockImplementation(() => {
      throw new Error('not configured');
    });
    const res = await deleteUser();
    expect(res.status).toBe(200);
  });

  it('answers 200 when reading the submission rows fails', async () => {
    const storage = seededStorage();
    const before = storage.objects.size;
    const { mock } = await load({ storage });
    const select = mock.db.select;
    mock.db.select = jest
      .fn()
      .mockImplementationOnce(select as any)
      .mockImplementationOnce(() => {
        throw new Error('db down');
      });
    const res = await deleteUser();
    expect(res.status).toBe(200);
    // nothing was found, the cleanup run (reason "deleted") takes the files
    expect(storage.objects.size).toBe(before);
  });
});

describe('DELETE /api/trainer/use-cases/[useCaseId]', () => {
  it('removes the files of the submissions of the use case, of every trainee, and no other', async () => {
    const storage = seededStorage();
    const { mock } = await load({ storage });
    const res = await deleteUseCase();
    expect(res.status).toBe(200);
    expect([...storage.objects.keys()]).toEqual([fileOf(TARGET, UC2)]);
    expect(mock.filters('select', 'use_case_submissions').params).toContain(
      UC1
    );
  });

  it('keeps the files when the delete fails', async () => {
    const storage = seededStorage();
    const before = storage.objects.size;
    await load({ storage, deleteError: new Error('connection lost') });
    const res = await deleteUseCase();
    expect(res.status).toBe(500);
    expect(storage.objects.size).toBe(before);
  });
});

describe('DELETE /api/trainer/courses/[courseId]', () => {
  it('removes the files of the submissions of every use case of the course', async () => {
    const storage = seededStorage();
    const { mock } = await load({ storage });
    const res = await deleteCourse();
    expect(res.status).toBe(200);
    expect([...storage.objects.keys()]).toEqual([fileOf(TARGET, UC2)]);
    // the use cases are those of the course, the submissions those of these use cases
    expect(mock.filters('select', 'use_cases').params).toContain(COURSE);
    expect(mock.filters('select', 'use_case_submissions').params).toContain(
      UC1
    );
  });

  it('removes nothing for a course without use cases', async () => {
    const storage = seededStorage();
    const before = storage.objects.size;
    await load({ storage, tables: { useCases: [] } });
    const res = await deleteCourse();
    expect(res.status).toBe(200);
    expect(storage.objects.size).toBe(before);
  });
});
