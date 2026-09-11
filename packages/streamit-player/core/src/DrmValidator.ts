import { PlayerController } from './PlayerController';
import type { DrmManager } from './DrmManager';

export interface ValidationReport {
  emeSupported: boolean;
  keySystems: Record<string, boolean>;
  activeSystem: string | null;
  hasMediaKeys: boolean;
  activeSessionsCount: number;
  sessionIds: string[];
  keyStatuses: string[];
  hasUsableKey: boolean;
  errors: string[];
  passed: boolean;

  // Production EME Validation
  requestMediaKeySystemAccessChecked: boolean;
  mediaKeysCreatedChecked: boolean;
  mediaKeysAttachedChecked: boolean;
  encryptedEventCount: number;
  licenseChallengeGeneratedCount: number;
  licenseRequestSentCount: number;
  licenseResponseReceivedCount: number;
  sessionUpdatedCount: number;
  keyStatusesChangeCount: number;
  usableKeysCount: number;
  expiredKeysCount: number;
  outputRestrictedCount: number;
  internalErrorsCount: number;
  closedSessionsCount: number;
  lastInternalError: string | null;
}

export class DrmValidator {
  /**
   * Performs an automated validation of the player's DRM state.
   */
  public static async validate(controller: PlayerController): Promise<ValidationReport> {
    const report: ValidationReport = {
      emeSupported:
        typeof navigator !== 'undefined' &&
        typeof navigator.requestMediaKeySystemAccess === 'function',
      keySystems: {},
      activeSystem: null,
      hasMediaKeys: false,
      activeSessionsCount: 0,
      sessionIds: [],
      keyStatuses: [],
      hasUsableKey: false,
      errors: [],
      passed: false,

      requestMediaKeySystemAccessChecked: false,
      mediaKeysCreatedChecked: false,
      mediaKeysAttachedChecked: false,
      encryptedEventCount: 0,
      licenseChallengeGeneratedCount: 0,
      licenseRequestSentCount: 0,
      licenseResponseReceivedCount: 0,
      sessionUpdatedCount: 0,
      keyStatusesChangeCount: 0,
      usableKeysCount: 0,
      expiredKeysCount: 0,
      outputRestrictedCount: 0,
      internalErrorsCount: 0,
      closedSessionsCount: 0,
      lastInternalError: null,
    };

    if (!report.emeSupported) {
      report.errors.push('EME is not supported on this platform/browser.');
      return report;
    }

    // Check availability of key systems
    const systems = {
      widevine: 'com.widevine.alpha',
      playready: 'com.microsoft.playready',
      fairplay: 'com.apple.fps',
      clearkey: 'org.w3.clearkey',
    };


    const videoCapabilities: MediaKeySystemMediaCapability[] = [
      { contentType: 'video/mp4; codecs="avc1.640028"' },
      { contentType: 'video/mp4; codecs="avc1.4d401e"' },
      { contentType: 'video/mp4' },
      { contentType: 'video/webm; codecs="vp9"' },
    ];

    const audioCapabilities: MediaKeySystemMediaCapability[] = [
      { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
      { contentType: 'audio/mp4' },
      { contentType: 'audio/webm; codecs="opus"' },
    ];

    for (const [name, sys] of Object.entries(systems)) {
      try {
        const config: MediaKeySystemConfiguration[] = [
          // 1. Preferred full capabilities
          {
            initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
            videoCapabilities,
            audioCapabilities,
          },
          // 2. Video fallback
          {
            initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
            videoCapabilities,
          },
          // 3. Audio fallback
          {
            initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
            audioCapabilities,
          },
          // 4. State/Identifier disabled fallback
          {
            initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
            videoCapabilities,
            persistentState: 'not-allowed',
            distinctiveIdentifier: 'not-allowed',
          },
        ];
        await navigator.requestMediaKeySystemAccess(sys, config);
        report.keySystems[name] = true;
      } catch (_) {
        report.keySystems[name] = false;
      }
    }

    // Access video and MediaKeys state
    const video = controller.getVideoElement();
    if (video) {
      if (video.mediaKeys) {
        report.hasMediaKeys = true;

        const drmManager: DrmManager | null = controller.getDrmManager();

        if (drmManager) {
          const drmConfig = drmManager.getConfig();
          if (drmConfig) {
            report.activeSystem =
              Object.keys(drmConfig).find(
                (k) =>
                  k !== 'robustness' &&
                  k !== 'distinctiveIdentifier' &&
                  k !== 'persistentState' &&
                  k !== 'retryCount' &&
                  k !== 'timeout'
              ) || null;
          }

          const sessions = drmManager.getActiveSessions();
          if (sessions) {
            report.activeSessionsCount = sessions.size;
            sessions.forEach((s) => {
              if (s.sessionId) {
                report.sessionIds.push(s.sessionId);
              }
              if (s.keyStatuses) {
                s.keyStatuses.forEach((status) => {
                  report.keyStatuses.push(String(status));
                  if (status === 'usable') {
                    report.hasUsableKey = true;
                  }
                });
              }
            });
          }

          const diag = drmManager.emeDiagnostics;
          if (diag) {
            report.requestMediaKeySystemAccessChecked = diag.requestMediaKeySystemAccess;
            report.mediaKeysCreatedChecked = diag.mediaKeysCreated;
            report.mediaKeysAttachedChecked = diag.mediaKeysAttached;
            report.encryptedEventCount = diag.encryptedEventsCount;
            report.licenseChallengeGeneratedCount = diag.challengesGenerated;
            report.licenseRequestSentCount = diag.licenseRequestsSent;
            report.licenseResponseReceivedCount = diag.licenseResponsesReceived;
            report.sessionUpdatedCount = diag.sessionsUpdated;
            report.keyStatusesChangeCount = diag.keyStatusesChanges;
            report.usableKeysCount = diag.usableKeysCount;
            report.expiredKeysCount = diag.expiredKeysCount;
            report.outputRestrictedCount = diag.outputRestrictedCount;
            report.internalErrorsCount = diag.internalErrorsCount;
            report.closedSessionsCount = diag.closedSessionsCount;
            report.lastInternalError = diag.lastInternalError;

            if (diag.expiredKeysCount > 0) {
              report.errors.push(`EME has ${diag.expiredKeysCount} expired key(s).`);
            }
            if (diag.outputRestrictedCount > 0) {
              report.errors.push(`EME playback restricted by HDCP output constraints.`);
            }
            if (diag.internalErrorsCount > 0 && diag.lastInternalError) {
              report.errors.push(`EME Internal Error: ${diag.lastInternalError}`);
            }
          }
        }
      }
    }

    const state = controller.getState();
    if (state && state.error) {
      report.errors.push(state.error);
    }

    // Pass criteria: EME must be supported and no errors logged
    report.passed = report.emeSupported && report.errors.length === 0;

    return report;
  }
}
