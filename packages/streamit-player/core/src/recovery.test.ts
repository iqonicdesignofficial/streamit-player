import { describe, it, expect } from 'vitest';
import { DEFAULT_RECOVERY, resolveRecoveryConfig, validateRecoveryConfig } from './recovery';

describe('resolveRecoveryConfig', () => {
  it('returns the documented defaults when nothing is configured', () => {
    for (const input of [undefined, null, {}, 'nope', 42, []]) {
      expect(resolveRecoveryConfig(input as never)).toEqual(DEFAULT_RECOVERY);
    }
    expect(DEFAULT_RECOVERY).toEqual({
      network: { maxRetries: 3, retryDelayMs: 2000, attemptTimeoutMs: 20000, noRetryStatuses: [401, 403, 410] },
      stall: { enabled: true, nudgeAfterMs: 5000, restartAfterMs: 15000, failAfterMs: 60000 },
      media: { resetAfterSeconds: 10 },
    });
  });

  describe('network.noRetryStatuses', () => {
    it('defaults to the codes that mean the credentials are refused or gone', () => {
      expect(resolveRecoveryConfig({}).network.noRetryStatuses).toEqual([401, 403, 410]);
    });

    it('takes a custom list, and an empty list switches the shortcut off', () => {
      expect(resolveRecoveryConfig({ network: { noRetryStatuses: [404, 451] } }).network.noRetryStatuses).toEqual([404, 451]);
      expect(resolveRecoveryConfig({ network: { noRetryStatuses: [] } }).network.noRetryStatuses).toEqual([]);
    });

    it('falls back to the default for anything that is not a list of HTTP statuses', () => {
      for (const bad of ['403', 403, null, {}, [403.5], [99], [600], ['403'], [NaN], [403, 'x']]) {
        expect(resolveRecoveryConfig({ network: { noRetryStatuses: bad } } as never).network.noRetryStatuses).toEqual([401, 403, 410]);
      }
    });

    it('drops duplicates and does not share the list with the defaults or the input', () => {
      const input = [403, 403, 410];
      const r = resolveRecoveryConfig({ network: { noRetryStatuses: input } });
      expect(r.network.noRetryStatuses).toEqual([403, 410]);

      (r.network.noRetryStatuses as number[]).push(999);
      expect(input).toEqual([403, 403, 410]);
      expect(resolveRecoveryConfig({}).network.noRetryStatuses).toEqual([401, 403, 410]);
      expect(DEFAULT_RECOVERY.network.noRetryStatuses).toEqual([401, 403, 410]);
    });

    it('is warned about when invalid, and a valid list (even empty) is not', () => {
      expect(validateRecoveryConfig({ network: { noRetryStatuses: [] } })).toEqual([]);
      expect(validateRecoveryConfig({ network: { noRetryStatuses: [404] } })).toEqual([]);
      expect(validateRecoveryConfig({ network: { noRetryStatuses: '403' } } as never).join('\n')).toMatch(
        /recovery\.network\.noRetryStatuses/
      );
      expect(validateRecoveryConfig({ network: { noRetryStatuses: [42] } } as never).join('\n')).toMatch(
        /recovery\.network\.noRetryStatuses/
      );
    });
  });

  it('applies valid overrides and keeps the rest at their defaults', () => {
    const r = resolveRecoveryConfig({
      network: { maxRetries: 5, retryDelayMs: 500 },
      stall: { failAfterMs: 120000 },
    });

    expect(r.network).toEqual({
      maxRetries: 5,
      retryDelayMs: 500,
      attemptTimeoutMs: 20000,
      noRetryStatuses: [401, 403, 410],
    });
    expect(r.stall).toEqual({
      enabled: true,
      nudgeAfterMs: 5000,
      restartAfterMs: 15000,
      failAfterMs: 120000,
    });
    expect(r.media.resetAfterSeconds).toBe(10);
  });

  it('allows zero retries (fail on the first error) and zero delay', () => {
    const r = resolveRecoveryConfig({ network: { maxRetries: 0, retryDelayMs: 0 } });

    expect(r.network.maxRetries).toBe(0);
    expect(r.network.retryDelayMs).toBe(0);
  });

  it('can switch the stall watchdog off', () => {
    expect(resolveRecoveryConfig({ stall: { enabled: false } }).stall.enabled).toBe(false);
  });

  it('ignores values of the wrong type or non-finite numbers', () => {
    const r = resolveRecoveryConfig({
      network: { maxRetries: '5', retryDelayMs: NaN, attemptTimeoutMs: Infinity },
      stall: { enabled: 'no', nudgeAfterMs: null, restartAfterMs: {}, failAfterMs: undefined },
      media: { resetAfterSeconds: '10' },
    } as never);

    expect(r).toEqual(DEFAULT_RECOVERY);
  });

  it('rounds retries to a whole number and clamps to sane bounds', () => {
    expect(resolveRecoveryConfig({ network: { maxRetries: 2.7 } }).network.maxRetries).toBe(2);
    expect(resolveRecoveryConfig({ network: { maxRetries: -4 } }).network.maxRetries).toBe(3);
    expect(resolveRecoveryConfig({ network: { maxRetries: 9999 } }).network.maxRetries).toBe(20);
    expect(resolveRecoveryConfig({ network: { retryDelayMs: -1 } }).network.retryDelayMs).toBe(2000);
    expect(resolveRecoveryConfig({ network: { retryDelayMs: 10 * 60 * 1000 } }).network.retryDelayMs).toBe(60000);
  });

  it('enforces minimums so a typo cannot create a hair-trigger', () => {
    const r = resolveRecoveryConfig({
      network: { attemptTimeoutMs: 5 },
      stall: { nudgeAfterMs: 1, restartAfterMs: 2, failAfterMs: 3 },
      media: { resetAfterSeconds: 0 },
    });

    expect(r.network.attemptTimeoutMs).toBe(20000);
    expect(r.stall).toEqual(DEFAULT_RECOVERY.stall);
    expect(r.media.resetAfterSeconds).toBe(10);
  });

  it('keeps the stall stages in order: nudge <= restart < fail', () => {
    // fail lowered below the default restart: restart moves to half of fail
    let s = resolveRecoveryConfig({ stall: { failAfterMs: 10000 } }).stall;
    expect(s.failAfterMs).toBe(10000);
    expect(s.restartAfterMs).toBe(5000);
    expect(s.nudgeAfterMs).toBeLessThanOrEqual(s.restartAfterMs);

    // nudge raised above restart: nudge is pulled down to restart
    s = resolveRecoveryConfig({ stall: { nudgeAfterMs: 30000 } }).stall;
    expect(s.nudgeAfterMs).toBe(15000);
    expect(s.restartAfterMs).toBe(15000);

    // everything explicit and consistent is left alone
    s = resolveRecoveryConfig({
      stall: { nudgeAfterMs: 2000, restartAfterMs: 8000, failAfterMs: 20000 },
    }).stall;
    expect([s.nudgeAfterMs, s.restartAfterMs, s.failAfterMs]).toEqual([2000, 8000, 20000]);
  });

  it('does not mutate its input or share state between calls', () => {
    const input = { stall: { failAfterMs: 10000 } };
    const a = resolveRecoveryConfig(input);
    a.stall.enabled = false;

    expect(input).toEqual({ stall: { failAfterMs: 10000 } });
    expect(resolveRecoveryConfig(undefined).stall.enabled).toBe(true);
    expect(DEFAULT_RECOVERY.stall.enabled).toBe(true);
  });
});

describe('validateRecoveryConfig', () => {
  it('has nothing to say about a valid or absent config', () => {
    expect(validateRecoveryConfig(undefined)).toEqual([]);
    expect(validateRecoveryConfig({})).toEqual([]);
    expect(
      validateRecoveryConfig({
        network: { maxRetries: 5 },
        stall: { enabled: false, failAfterMs: 90000 },
      })
    ).toEqual([]);
  });

  it('warns about a recovery value that is not an object', () => {
    expect(validateRecoveryConfig('fast' as never)[0]).toMatch(/'recovery' must be an object/);
    expect(validateRecoveryConfig({ network: 3 } as never)[0]).toMatch(/'recovery.network' must be an object/);
  });

  it('names each value that was ignored or adjusted', () => {
    const warnings = validateRecoveryConfig({
      network: { maxRetries: -1, retryDelayMs: '2s', attemptTimeoutMs: 5 },
      stall: { enabled: 'yes', failAfterMs: 10000, restartAfterMs: 20000 },
      media: { resetAfterSeconds: 0 },
    } as never);

    const text = warnings.join('\n');
    expect(text).toMatch(/recovery\.network\.maxRetries/);
    expect(text).toMatch(/recovery\.network\.retryDelayMs/);
    expect(text).toMatch(/recovery\.network\.attemptTimeoutMs/);
    expect(text).toMatch(/recovery\.stall\.enabled/);
    expect(text).toMatch(/recovery\.stall\.restartAfterMs/);
    expect(text).toMatch(/recovery\.media\.resetAfterSeconds/);
  });

  it('warns about unknown keys, which are usually typos', () => {
    const warnings = validateRecoveryConfig({
      network: { maxRetrys: 3 },
      stal: {},
    } as never);

    expect(warnings.join('\n')).toMatch(/recovery\.network\.maxRetrys/);
    expect(warnings.join('\n')).toMatch(/recovery\.stal/);
  });
});
