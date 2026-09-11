export type SimidSessionState =
  | 'idle'
  | 'available'
  | 'loading'
  | 'initialized'
  | 'running'
  | 'completed'
  | 'destroyed';

export interface SimidOptions {
  allowedOrigins?: string[];
  /** Max time to wait for the creative's handshake (createSession + init resolve), in ms. Default 8000. */
  handshakeTimeoutMs?: number;
  /** Max time to wait for the creative iframe's own document to finish loading, in ms. Default 10000. */
  creativeTimeoutMs?: number;
  maxDurationExtensionSec?: number;
  allowClickThru?: boolean;
  onSimidClickThru?: (url: string, clickTrackingUrls: string[]) => boolean | void;
  /** Logs every SIMID protocol message to the console. Default true - set false to silence in production. */
  debug?: boolean;
}

export type SimidConfig = SimidOptions;

export enum SimidErrorCode {
  HANDSHAKE_TIMEOUT = 1001,
  CREATIVE_LOAD_FAILURE = 1002,
  SECURITY_VIOLATION = 1003,
  INVALID_PAYLOAD = 1004,
  CREATIVE_FATAL_ERROR = 1005,
  RUNTIME_ERROR = 1006,
}

/**
 * The subset of an `Advertisement`/`VastAdvertisement` (from
 * `../providers/VastProvider`) that SimidManager/SimidRuntime read to detect
 * and build a SIMID session. Kept as a locally-defined structural shape
 * rather than importing `VastAdvertisement` directly, since that would
 * create a circular import (VastProvider → SimidRuntime → VastProvider).
 * `adParameters`/`clickThruUrl` aren't real `Advertisement` fields - they're
 * defensive fallbacks for non-standard ad sources that might set them.
 */
export interface SimidAdInput {
  id?: string;
  interactiveCreativeFile?: string | null;
  contentType?: string;
  creativeParameters?: string | Record<string, unknown>;
  adParameters?: string;
  clickThroughUrl?: string;
  clickThruUrl?: string;
  clickTrackingUrls?: Array<string | { url: string }>;
  skippable?: boolean;
}

export interface SimidCreative {
  interactiveCreativeFile: string;
  creativeType?: string;
  creativeParameters?: string | Record<string, unknown>;
  adId?: string;
  clickThruUrl?: string;
  clickTrackingUrls?: string[];
}

export interface SimidMessage {
  sessionId: string;
  messageId: string;
  correlationId?: string;
  type: string;
  /** SIMID message payload - genuinely opaque; shape varies per `type`
   * (see SimidClickThruArgs/SimidChangeDurationArgs/SimidFatalErrorArgs for
   * the shapes callers narrow it to at specific message types). */
  data?: unknown;
  args?: unknown;
}

export interface SimidCapabilities {
  simidVersion: string;
  iframeSupported: boolean;
  secureMessagingSupported: boolean;
  postMessageSupported: boolean;
  clickThruSupported?: boolean;
  durationChangeSupported?: boolean;
}

export interface SimidError {
  code: number | SimidErrorCode;
  message: string;
  fatal: boolean;
}

export interface SimidDiagnostics {
  simidAvailable: boolean;
  creativeDetected: boolean;
  sessionCreatedCount: number;
  bridgeInitSuccess: boolean;
  messagesRoutedCount: number;
  capabilities: SimidCapabilities | null;
  errorLog: SimidError[];
}

export interface SimidDiagnosticsData extends SimidDiagnostics {
  iframeLoaded: boolean;
  handshakeDurationMs: number;
  messagesSent: number;
  messagesReceived: number;
  validationFailures: number;
  sessionState: SimidSessionState | null;
  sessionLifetimeMs: number;
}

export interface SimidPublicSession {
  sessionId: string;
  state: SimidSessionState;
  creative: SimidCreative;
  errors: SimidError[];
}

export interface SimidClickThruArgs {
  x?: number;
  y?: number;
  playerHandles?: boolean;
  clickUrl?: string;
}

export interface SimidChangeDurationArgs {
  duration?: number;
  extensionSec?: number;
}

export interface SimidFatalErrorArgs {
  code?: number;
  message?: string;
}
