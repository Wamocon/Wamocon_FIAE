import {
  SIGN_IN_TIMEOUT_CODE,
  SignInTimeoutError,
  isSignInTimeout,
  withTimeout,
} from '@/lib/auth/sign-in-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives the value of a promise that settles in time and leaves no timer', async () => {
    const result = withTimeout(Promise.resolve('ok'), 1000);
    await expect(result).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('passes on the rejection of a promise that fails in time and leaves no timer', async () => {
    const failure = new Error('boom');
    await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(
      failure
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with a SignInTimeoutError when the promise never settles', async () => {
    const onTimeout = jest.fn();
    const result = withTimeout(new Promise(() => undefined), 1000, onTimeout);
    const caught = result.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(999);
    expect(onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(error).toBeInstanceOf(SignInTimeoutError);
    expect(isSignInTimeout(error)).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores a promise that settles after the limit, without an unhandled rejection', async () => {
    let rejectLate: (e: Error) => void = () => undefined;
    const late = new Promise((_resolve, reject) => {
      rejectLate = reject;
    });
    const caught = withTimeout(late, 1000).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await caught).toBeInstanceOf(SignInTimeoutError);
    rejectLate(new Error('too late'));
    await Promise.resolve();
  });
});

describe('SignInTimeoutError', () => {
  it('carries the code and the clear message', () => {
    const error = new SignInTimeoutError();
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(SIGN_IN_TIMEOUT_CODE);
    expect(error.message).toBe(
      'Die Anmeldung dauert zu lange. Bitte laden Sie die Seite neu und versuchen Sie es erneut.'
    );
  });

  it('is recognized by its code, not only by its class', () => {
    expect(isSignInTimeout({ code: SIGN_IN_TIMEOUT_CODE })).toBe(true);
    expect(isSignInTimeout(new Error('x'))).toBe(false);
    expect(isSignInTimeout(null)).toBe(false);
    expect(isSignInTimeout('SIGN_IN_TIMEOUT')).toBe(false);
  });
});
