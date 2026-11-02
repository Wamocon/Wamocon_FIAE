import { readLinkAnswers } from '@/lib/submission-file/readLink';

// One byte is asked for before the page navigates to a read link of the storage
// (WMCNL-2998): a link that the storage refuses must show a message, not end in a
// request that fails in the background.

const answer = (ok: boolean, cancel = jest.fn(async () => undefined)) => ({
  ok,
  body: { cancel } as unknown as ReadableStream,
});

describe('readLinkAnswers', () => {
  it('asks for one byte, without a cache', async () => {
    const fetchImpl = jest.fn(async () => answer(true));
    await readLinkAnswers('https://x/y', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://x/y', {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
  });

  it('is true for an answer of the storage and drops the body', async () => {
    const cancel = jest.fn(async () => undefined);
    expect(await readLinkAnswers('u', async () => answer(true, cancel))).toBe(
      true
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('is false when the storage refuses (503, 404, 400)', async () => {
    expect(await readLinkAnswers('u', async () => answer(false))).toBe(false);
  });

  it('is true when the page cannot tell (the browser refuses the read, no network)', async () => {
    expect(
      await readLinkAnswers('u', async () => {
        throw new TypeError('Failed to fetch');
      })
    ).toBe(true);
  });

  it('copes with an answer without a body', async () => {
    expect(
      await readLinkAnswers('u', async () => ({ ok: true, body: null }))
    ).toBe(true);
  });
});
