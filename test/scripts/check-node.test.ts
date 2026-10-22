import { describe, expect, it } from 'vitest';
import { checkNodeVersion, MIN_PATCHED } from '../../scripts/check-node.mjs';

describe('scripts/check-node.mjs', () => {
  it('accepts the exact patched release on each even line', () => {
    for (const v of Object.values(MIN_PATCHED)) {
      expect(checkNodeVersion(`v${v}`).ok).toBe(true);
    }
  });

  it('accepts later patches and minors on an accepted line', () => {
    expect(checkNodeVersion('v26.12.2').ok).toBe(true);
    expect(checkNodeVersion('v26.13.0').ok).toBe(true);
    expect(checkNodeVersion('v24.23.0').ok).toBe(true);
    expect(checkNodeVersion('v22.24.0').ok).toBe(true);
  });

  it('rejects the release immediately before the fix on each line', () => {
    expect(checkNodeVersion('v22.23.3').ok).toBe(false);
    expect(checkNodeVersion('v24.22.0').ok).toBe(false);
    expect(checkNodeVersion('v26.12.0').ok).toBe(false);
    expect(checkNodeVersion('v26.11.99').ok).toBe(false);
  });

  it('rejects odd-numbered and end-of-life majors regardless of patch', () => {
    for (const v of ['v20.99.99', 'v18.20.4', 'v23.11.1', 'v25.9.0', 'v27.0.0']) {
      expect(checkNodeVersion(v).ok, v).toBe(false);
    }
  });

  it('rejects garbage', () => {
    expect(checkNodeVersion('lts').ok).toBe(false);
    expect(checkNodeVersion('').ok).toBe(false);
  });

  it('agrees with .nvmrc and .node-version', async () => {
    const fs = await import('node:fs');
    const nvmrc = fs.readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
    const nodeVersion = fs.readFileSync(new URL('../../.node-version', import.meta.url), 'utf8').trim();
    expect(nvmrc).toBe(nodeVersion);
    expect(checkNodeVersion(`v${nvmrc}`).ok).toBe(true);
    expect(nvmrc).toBe(MIN_PATCHED[26]);
  });
});
