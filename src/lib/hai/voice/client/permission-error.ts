/** The browser refused the microphone or speech recognition (permission error names). */
export function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}
