import { PlayerController } from './PlayerController';
import { AdsManager } from './AdsManager';
import { AdScheduler, ScheduledAdRequest } from './AdScheduler';
import { VastProvider } from './providers/VastProvider';
import { VmapProvider } from './providers/VmapProvider';
import { ImaProvider } from './providers/ImaProvider';
import {
  PlayerState,
  Advertisement,
  HtmlOverlayConfig,
  AdBreak,
  AdProvider,
  CapabilityInfo,
  AdsDiagnostics,
  AdsValidationReport,
  AdsValidator,
  AdState,
  ProviderContext,
} from './types';
import { HtmlOverlayDiagnostics } from './html-overlay/HtmlOverlayRenderer';

export class AdsController {
  private controller: PlayerController;
  public readonly manager: AdsManager;
  private providers: Map<string, AdProvider> = new Map();
  private activeProviderName: string | null = null;
  private adContainerElement: HTMLElement | null = null;

  constructor(controller: PlayerController) {
    this.controller = controller;
    this.manager = new AdsManager();
    this.controller.use(this.manager);

    // Auto-register built-in core providers
    this.registerProvider('VAST', new VastProvider());
    this.registerProvider('VMAP', new VmapProvider());
    this.registerProvider('IMA', new ImaProvider());
  }

  public setAdContainer(container: HTMLElement): void {
    this.adContainerElement = container;
    this.manager.setAdContainer(container);

    // Re-initialize all registered providers with updated adContainer context
    this.providers.forEach((_provider, name) => {
      this.initializeProvider(name, container);
    });
  }

  public getAdContainer(): HTMLElement | null {
    return this.adContainerElement || this.manager.getAdContainer();
  }

  public state(): Partial<PlayerState> {
    const s = this.controller.getState();
    return {
      isAdPlaying: s.isAdPlaying,
      isAdLoading: s.isAdLoading,
      currentAd: s.currentAd,
      currentAdBreak: s.currentAdBreak,
      adRemainingTime: s.adRemainingTime,
      adDuration: s.adDuration,
      canSkipAd: s.canSkipAd,
      skipAvailableAt: s.skipAvailableAt,
      adPosition: s.adPosition,
      adProvider: s.adProvider,
      adLinear: s.adLinear,
      adMuted: s.adMuted,
    };
  }

  public provider(): string | null {
    return this.activeProviderName;
  }

  public capabilities(): CapabilityInfo | null {
    if (this.activeProviderName) {
      const p = this.providers.get(this.activeProviderName);
      if (p) return p.capabilities;
    }
    return null;
  }

  public currentAd(): Advertisement | null {
    return this.controller.getState().currentAd;
  }

  public currentBreak(): AdBreak | null {
    return this.controller.getState().currentAdBreak;
  }

  public skip(): void {
    this.manager.skipAd();
  }

  public pause(): void {
    this.manager.pause();
  }

  public resume(): void {
    this.manager.play();
  }

  public enable(): void {
    this.controller.setAdsEnabled(true);
  }

  public disable(): void {
    this.controller.setAdsEnabled(false);
  }

  private scheduler: AdScheduler | null = null;

  private getScheduler(): AdScheduler {
    if (!this.scheduler) {
      this.scheduler = new AdScheduler(
        this.controller,
        (name) => this.getProvider(name),
        (config) => this.manager.showOverlay(config)
      );
    }
    return this.scheduler;
  }

  public schedule(request: ScheduledAdRequest): string {
    const vmap = this.providers.get('VMAP') as VmapProvider | undefined;
    if (vmap?.hasScheduledBreaks?.()) {
      console.warn(
        '[AdsController] schedule() called while a VMAP playlist has active breaks - AdScheduler and ' +
        'VmapProvider independently watch the same video timeline and are not supported together on one ' +
        'player instance; this can result in duplicate/overlapping ad breaks.'
      );
      this.controller.emit('adschedulerconflict', {
        source: 'scheduler',
        reason: 'AdScheduler.schedule() called while VmapProvider has active breaks',
      });
    }
    return this.getScheduler().schedule(request);
  }

  /** True if there's an active manual schedule (via schedule()) with unplayed
   * breaks - used by VmapProvider to detect the unsupported combination. */
  public hasActiveManualSchedule(): boolean {
    return !!this.scheduler && this.scheduler.hasActiveBreaks();
  }

  public unschedule(id: string): void {
    this.scheduler?.unschedule(id);
  }

  public clearSchedule(): void {
    this.scheduler?.clear();
  }

  public async play(tagUrl: string): Promise<void> {
    const provider = this.getProvider('VAST');
    if (!provider) return;
    const result = await provider.requestAds(tagUrl);
    if (result.success) {
      await provider.playAdBreak();
    }
  }

  public registerProvider(name: string, provider: AdProvider, adContainer?: HTMLElement): void {
    this.providers.set(name, provider);
    this.manager.getProviderManager().registerProvider(name, provider);

    if (!this.activeProviderName || this.controller.config?.ads?.provider === name) {
      this.activeProviderName = name;
      this.manager.getProviderManager().selectProvider(name);
    }

    this.initializeProvider(name, adContainer);
  }

  public initializeProvider(name: string, adContainer?: HTMLElement): boolean {
    const provider = this.providers.get(name);
    if (!provider) return false;

    const container = adContainer || this.adContainerElement || this.manager.getAdContainer() || undefined;
    const context: ProviderContext = this.manager.createProviderContext(container as HTMLElement);

    try {
      provider.init(context);
      return true;
    } catch (e) {
      console.error(`[AdsController] Failed to initialize provider "${name}":`, e);
      return false;
    }
  }

  public getProvider(name: string): AdProvider | undefined {
    let provider = this.providers.get(name);
    if (!provider) {
      // Lazy auto-construction fallback for core provider types
      if (name === 'VAST') {
        provider = new VastProvider();
        this.registerProvider('VAST', provider);
      } else if (name === 'VMAP') {
        provider = new VmapProvider();
        this.registerProvider('VMAP', provider);
      } else if (name === 'IMA') {
        provider = new ImaProvider();
        this.registerProvider('IMA', provider);
      }
    }

    if (provider) {
      this.initializeProvider(name);
    }

    return provider;
  }

  public unregisterProvider(name: string): void {
    const provider = this.providers.get(name);
    if (provider) {
      try {
        provider.destroy();
      } catch (e) {
        // ignore
      }
    }
    this.providers.delete(name);
    this.manager.getProviderManager().unregisterProvider(name);

    if (this.activeProviderName === name) {
      this.activeProviderName = null;
    }
  }

  public destroy(): void {
    this.scheduler?.destroy();
    this.scheduler = null;
  }

  public async showOverlay(adOrConfig: Advertisement | HtmlOverlayConfig): Promise<boolean> {
    return this.manager.showOverlay(adOrConfig);
  }

  public hideOverlay(): void {
    this.manager.hideOverlay();
  }

  public closeOverlay(): void {
    this.manager.closeOverlay();
  }

  public updateOverlay(patch: Partial<HtmlOverlayConfig>): void {
    this.manager.updateOverlay(patch);
  }

  public getOverlayDiagnostics(): HtmlOverlayDiagnostics | null {
    const renderer = this.manager.getHtmlOverlayRenderer();
    return renderer ? renderer.getDiagnostics() : null;
  }

  public diagnostics(): AdsDiagnostics {
    const stats = this.manager.getDiagnosticsStats();
    const renderer = this.manager.getHtmlOverlayRenderer();
    return {
      providerName: this.activeProviderName,
      state: this.manager.getAdState(),
      configuration: this.controller.config?.ads || null,
      lastError: null,
      statistics: {
        totalAdsRequested: stats.totalAdsRequested,
        totalAdsPlayed: stats.totalAdsPlayed,
        totalAdsCompleted: stats.totalAdsCompleted,
        totalAdsSkipped: stats.totalAdsSkipped,
        totalAdErrors: stats.totalAdErrors,
      },
      htmlOverlay: renderer ? renderer.getDiagnostics() : null,
    };
  }

  public validate(): AdsValidationReport {
    return AdsValidator.validate(this.controller);
  }
}
