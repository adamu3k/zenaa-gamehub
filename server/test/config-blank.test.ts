import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test' } as NodeJS.ProcessEnv;

describe('config', () => {
  it('treats an empty ADMIN_PASSWORD / ADMIN_USERNAME as not set (Docker Compose passes removed variables as "")', () => {
    const c = loadConfig({ ...base, ADMIN_PASSWORD: '', ADMIN_USERNAME: '' });
    expect(c.ADMIN_PASSWORD).toBeUndefined();
    expect(c.ADMIN_USERNAME).toBe('admin');
  });
  it('still rejects a short admin password', () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'short' })).toThrow(/at least 8/);
  });
});
