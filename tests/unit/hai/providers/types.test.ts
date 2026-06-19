/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { loadProviderConfig } from '../../../../src/lib/hai/providers/types';

describe('loadProviderConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load openai-compatible provider config from environment', () => {
    process.env.HAI_CHAT_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://sokrates.test-qualitaetsmanagement.com/api';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'sk-test-key';
    process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-4o';

    const config = loadProviderConfig();

    expect(config.chatProvider).toBe('openai-compatible');
    expect(config.openaiCompatible.baseUrl).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api'
    );
    expect(config.openaiCompatible.apiKey).toBe('sk-test-key');
    expect(config.openaiCompatible.model).toBe('gpt-4o');
  });

  it('should fall back to default Sokrates endpoint and gpt-4o-mini', () => {
    delete process.env.HAI_CHAT_PROVIDER;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_MODEL;

    const config = loadProviderConfig();

    expect(config.chatProvider).toBe('gemini');
    expect(config.openaiCompatible.baseUrl).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api'
    );
    expect(config.openaiCompatible.apiKey).toBeUndefined();
    expect(config.openaiCompatible.model).toBe('gpt-4o-mini');
  });

  it('should reject unknown chat provider and fall back to gemini', () => {
    process.env.HAI_CHAT_PROVIDER = 'unknown-provider';

    const config = loadProviderConfig();

    expect(config.chatProvider).toBe('gemini');
  });
});
