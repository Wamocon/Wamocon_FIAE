/**
 * @jest-environment node
 */
import { askAgainOnServerFailure } from '@/lib/hai/goldenSet';
import { ChatUnavailableError } from '@/lib/hai/providers/errors';

// The retry of the measurement on a failure of the server (docs/hai-golden-set.md,
// 5e). The old loop looked at a returned empty text only. A provider does not
// return it, it throws (kind empty, turned into a ChatUnavailableError by the
// chain), so `emptyRepliesAskedAgain` stayed 0 although empty answers occurred.

describe('askAgainOnServerFailure', () => {
  const noPause = async () => undefined;

  it('a reply with text is taken as it is and nothing is asked again', async () => {
    const ask = jest.fn().mockResolvedValue({ text: 'Antwort' });
    const result = await askAgainOnServerFailure(ask, 2, noPause);
    expect(result).toEqual({
      reply: { text: 'Antwort' },
      askedAgain: 0,
      failure: null,
    });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('an empty text is asked again (the shape the old loop knew)', async () => {
    const ask = jest
      .fn()
      .mockResolvedValueOnce({ text: ' ' })
      .mockResolvedValueOnce({ text: 'Antwort' });
    const result = await askAgainOnServerFailure(ask, 2, noPause);
    expect(result.reply?.text).toBe('Antwort');
    expect(result.askedAgain).toBe(1);
  });

  it('a provider that THROWS on an empty answer is asked again too (the case that was missed)', async () => {
    const unavailable = new ChatUnavailableError(
      'no_fallback',
      'primary_is_sokrates',
      'openai-compatible: empty'
    );
    const ask = jest
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ text: 'Antwort' });
    const pause = jest.fn(noPause);
    const result = await askAgainOnServerFailure(ask, 2, pause);
    expect(result.reply?.text).toBe('Antwort');
    expect(result.askedAgain).toBe(2);
    expect(result.failure).toBeNull();
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('when every try fails, the last failure is returned and the count is the number of retries', async () => {
    const unavailable = new ChatUnavailableError('no_fallback', 'disabled');
    const ask = jest.fn().mockRejectedValue(unavailable);
    const result = await askAgainOnServerFailure(ask, 2, noPause);
    expect(result.reply).toBeNull();
    expect(result.failure).toBe(unavailable);
    expect(result.askedAgain).toBe(2);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('with no retries it asks once', async () => {
    const ask = jest.fn().mockResolvedValue({ text: '' });
    const result = await askAgainOnServerFailure(ask, 0, noPause);
    expect(result.askedAgain).toBe(0);
    expect(result.reply?.text).toBe('');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('another error is not a failure of the server: it goes on at once', async () => {
    const ask = jest.fn().mockRejectedValue(new Error('bug in the test'));
    await expect(askAgainOnServerFailure(ask, 2, noPause)).rejects.toThrow(
      'bug in the test'
    );
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
