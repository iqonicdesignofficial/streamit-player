import type { RecoveryConfig } from './types';

/**
 * Resolution and validation of `config.recovery` (see {@link RecoveryConfig}).
 *
 * Both functions are driven by the same table, so what is warned about is
 * exactly what is ignored. Anything invalid falls back to the default rather
 * than throwing: a typo in a tuning option must never stop video from playing.
 */

export interface ResolvedRecovery {
  network: {
    maxRetries: number;
    retryDelayMs: number;
    attemptTimeoutMs: number;
    noRetryStatuses: readonly number[];
  };
  stall: { enabled: boolean; nudgeAfterMs: number; restartAfterMs: number; failAfterMs: number };
  media: { resetAfterSeconds: number };
}

/** The server refused the credentials (401, 403) or says the resource is gone (410): asking again cannot help. */
const DEFAULT_NO_RETRY_STATUSES: readonly number[] = Object.freeze([401, 403, 410]);

export const DEFAULT_RECOVERY: Readonly<ResolvedRecovery> = Object.freeze({
  network: Object.freeze({
    maxRetries: 3,
    retryDelayMs: 2000,
    attemptTimeoutMs: 20000,
    noRetryStatuses: DEFAULT_NO_RETRY_STATUSES,
  }),
  stall: Object.freeze({
    enabled: true,
    nudgeAfterMs: 5000,
    restartAfterMs: 15000,
    failAfterMs: 60000,
  }),
  media: Object.freeze({ resetAfterSeconds: 10 }),
}) as Readonly<ResolvedRecovery>;

type Block = 'network' | 'stall' | 'media';

interface NumberSpec {
  block: Block;
  key: string;
  /** Round down to a whole number. */
  integer?: boolean;
  /** Smallest accepted value; below it the default is used. */
  min: number;
  /** Largest accepted value; above it the value is clamped. */
  max: number;
  /** Human description used in warnings. */
  expects: string;
}

const NUMBER_SPECS: NumberSpec[] = [
  { block: 'network', key: 'maxRetries', integer: true, min: 0, max: 20, expects: 'a whole number from 0 to 20' },
  { block: 'network', key: 'retryDelayMs', min: 0, max: 60000, expects: 'a number of milliseconds from 0 to 60000' },
  { block: 'network', key: 'attemptTimeoutMs', min: 1000, max: 600000, expects: 'a number of milliseconds of at least 1000' },
  { block: 'stall', key: 'nudgeAfterMs', min: 1000, max: 3600000, expects: 'a number of milliseconds of at least 1000' },
  { block: 'stall', key: 'restartAfterMs', min: 1000, max: 3600000, expects: 'a number of milliseconds of at least 1000' },
  { block: 'stall', key: 'failAfterMs', min: 1000, max: 3600000, expects: 'a number of milliseconds of at least 1000' },
  { block: 'media', key: 'resetAfterSeconds', min: 1, max: 3600, expects: 'a number of seconds of at least 1' },
];

const BOOLEAN_SPECS: Array<{ block: Block; key: string }> = [{ block: 'stall', key: 'enabled' }];

const KNOWN_KEYS: Record<Block, string[]> = {
  network: ['maxRetries', 'retryDelayMs', 'attemptTimeoutMs', 'noRetryStatuses'],
  stall: ['enabled', 'nudgeAfterMs', 'restartAfterMs', 'failAfterMs'],
  media: ['resetAfterSeconds'],
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isUsableNumber = (v: unknown, spec: NumberSpec): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= spec.min;

/** A list (possibly empty) of whole HTTP status codes. */
const isStatusList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599);

function readBlock(config: unknown, block: Block): Record<string, unknown> {
  if (!isPlainObject(config)) return {};
  const value = config[block];
  return isPlainObject(value) ? value : {};
}

/** Merges `config.recovery` over the defaults, ignoring anything invalid. Never throws, never mutates its input. */
export function resolveRecoveryConfig(config: RecoveryConfig | undefined | null): ResolvedRecovery {
  const resolved: ResolvedRecovery = {
    network: { ...DEFAULT_RECOVERY.network, noRetryStatuses: [...DEFAULT_NO_RETRY_STATUSES] },
    stall: { ...DEFAULT_RECOVERY.stall },
    media: { ...DEFAULT_RECOVERY.media },
  };

  const statuses = readBlock(config, 'network').noRetryStatuses;
  if (isStatusList(statuses)) resolved.network.noRetryStatuses = [...new Set(statuses)];

  for (const spec of NUMBER_SPECS) {
    const raw = readBlock(config, spec.block)[spec.key];
    if (!isUsableNumber(raw, spec)) continue;
    const clamped = Math.min(spec.integer ? Math.floor(raw) : raw, spec.max);
    (resolved[spec.block] as Record<string, unknown>)[spec.key] = clamped;
  }

  for (const spec of BOOLEAN_SPECS) {
    const raw = readBlock(config, spec.block)[spec.key];
    if (typeof raw === 'boolean') {
      (resolved[spec.block] as Record<string, unknown>)[spec.key] = raw;
    }
  }

  // Stall stages must happen in order: nudge, then restart, then give up. A
  // restart that would not come before the fatal error moves to half of it.
  const stall = resolved.stall;
  if (stall.restartAfterMs >= stall.failAfterMs) {
    stall.restartAfterMs = Math.max(500, Math.floor(stall.failAfterMs / 2));
  }
  if (stall.nudgeAfterMs > stall.restartAfterMs) {
    stall.nudgeAfterMs = stall.restartAfterMs;
  }

  return resolved;
}

/**
 * Human-readable warnings for every part of `config.recovery` that will be
 * ignored or adjusted. Empty when the config is valid (or absent).
 */
export function validateRecoveryConfig(config: unknown): string[] {
  const warnings: string[] = [];
  if (config === undefined || config === null) return warnings;
  if (!isPlainObject(config)) {
    warnings.push(`'recovery' must be an object, got ${Array.isArray(config) ? 'array' : typeof config}; using defaults.`);
    return warnings;
  }

  for (const key of Object.keys(config)) {
    if (!(key in KNOWN_KEYS)) {
      warnings.push(`Unknown option 'recovery.${key}' ignored. Known: ${Object.keys(KNOWN_KEYS).join(', ')}.`);
    }
  }

  for (const block of Object.keys(KNOWN_KEYS) as Block[]) {
    const value = config[block];
    if (value === undefined) continue;
    if (!isPlainObject(value)) {
      warnings.push(`'recovery.${block}' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}; using defaults.`);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (!KNOWN_KEYS[block].includes(key)) {
        warnings.push(`Unknown option 'recovery.${block}.${key}' ignored. Known: ${KNOWN_KEYS[block].join(', ')}.`);
      }
    }
  }

  for (const spec of NUMBER_SPECS) {
    const raw = readBlock(config, spec.block)[spec.key];
    if (raw === undefined) continue;
    if (!isUsableNumber(raw, spec)) {
      warnings.push(
        `'recovery.${spec.block}.${spec.key}' must be ${spec.expects}, got ${JSON.stringify(raw)}; using the default (${(DEFAULT_RECOVERY[spec.block] as Record<string, unknown>)[spec.key]}).`
      );
    } else if (raw > spec.max) {
      warnings.push(`'recovery.${spec.block}.${spec.key}' is above ${spec.max}; using ${spec.max}.`);
    }
  }

  const statuses = readBlock(config, 'network').noRetryStatuses;
  if (statuses !== undefined && !isStatusList(statuses)) {
    warnings.push(
      `'recovery.network.noRetryStatuses' must be a list of HTTP status codes (100-599), got ${JSON.stringify(statuses)}; using the default (${JSON.stringify(DEFAULT_NO_RETRY_STATUSES)}).`
    );
  }

  for (const spec of BOOLEAN_SPECS) {
    const raw = readBlock(config, spec.block)[spec.key];
    if (raw !== undefined && typeof raw !== 'boolean') {
      warnings.push(`'recovery.${spec.block}.${spec.key}' must be a boolean, got ${typeof raw}; using the default.`);
    }
  }

  // Stall stages the resolver had to reorder, when the user set them explicitly.
  const requested = readBlock(config, 'stall');
  const resolved = resolveRecoveryConfig(config as RecoveryConfig).stall;
  for (const key of ['restartAfterMs', 'nudgeAfterMs'] as const) {
    const spec = NUMBER_SPECS.find((s) => s.block === 'stall' && s.key === key)!;
    const raw = requested[key];
    if (isUsableNumber(raw, spec) && resolved[key] !== Math.min(raw, spec.max)) {
      warnings.push(
        `'recovery.stall.${key}' (${raw}) must come before the next stage; using ${resolved[key]}. Order: nudgeAfterMs <= restartAfterMs < failAfterMs.`
      );
    }
  }

  return warnings;
}
