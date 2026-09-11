import { PlayerConfiguration, PlayerEvents, PlayerSource, PlayerState } from './types';

/**
 * The minimal surface of `PlayerController` that `PlaylistManager` depends on.
 * Declared explicitly so the manager's dependency surface stays small and
 * auditable rather than "the whole controller as `any`".
 */
export interface PlaylistManagerHost {
  readonly config: PlayerConfiguration;
  getState(): PlayerState;
  updateStatePublic(changes: Partial<PlayerState>): void;
  dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void;
  loadSource(source: PlayerSource, clearPlaylist?: boolean): void;
  play(): void;
}

/**
 * Owns all playlist state and navigation behaviour previously inlined in
 * `PlayerController`. `PlayerController` keeps identical public methods that
 * delegate one-for-one into this class.
 */
export class PlaylistManager {
  private readonly host: PlaylistManagerHost;

  private originalPlaylist: PlayerSource[] | null = null;
  private historyStack: number[] = [];
  private nearEndThreshold = 1;
  private hasDispatchedNearEndForCurrentBoundary = false;

  constructor(host: PlaylistManagerHost) {
    this.host = host;
    const configured = host.config?.nearEndThreshold;
    this.nearEndThreshold = configured !== undefined ? Math.max(1, configured) : 1;
  }

  private get state(): PlayerState {
    return this.host.getState();
  }

  private updateState(changes: Partial<PlayerState>): void {
    this.host.updateStatePublic(changes);
  }

  private dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void {
    this.host.dispatchEvent(event, detail);
  }

  public loadPlaylist(sources: PlayerSource[], startIndex: number = 0): void {
    if (sources.length === 0) {
      this.clearPlaylist();
      return;
    }
    this.originalPlaylist = null;
    const nextIndex = Math.max(0, Math.min(startIndex, sources.length - 1));
    this.historyStack = [];
    this.hasDispatchedNearEndForCurrentBoundary = false;
    this.updateState({
      playlist: sources,
      activePlaylistIndex: nextIndex,
    });
    this.dispatchEvent('playlist-loaded', { playlist: sources, startIndex: nextIndex });
    this.dispatchEvent('playlist-change', { playlist: sources });

    if (sources.length > 0) {
      this.loadPlaylistItem(nextIndex, true);
    }
  }

  public setPlaylist(sources: PlayerSource[], startIndex = 0): void {
    this.loadPlaylist(sources, startIndex);
  }

  public setNearEndThreshold(threshold: number): void {
    this.nearEndThreshold = Math.max(1, threshold);
    this.hasDispatchedNearEndForCurrentBoundary = false;
    this.checkPlaylistNearEnd();
  }

  public getNearEndThreshold(): number {
    return this.nearEndThreshold;
  }

  public getPlaylist(): PlayerSource[] {
    return this.state.playlist;
  }

  public getCurrentPlaylistIndex(): number {
    return this.state.activePlaylistIndex;
  }

  public getHistoryStack(): number[] {
    return [...this.historyStack];
  }

  public getCurrentPlaylistItem(): PlayerSource | null {
    if (!this.hasPlaylist()) return null;
    const index = this.state.activePlaylistIndex;
    if (index < 0 || index >= this.state.playlist.length) return null;
    return this.state.playlist[index];
  }

  public getPlaylistLength(): number {
    return this.state.playlist.length;
  }

  public hasPlaylist(): boolean {
    return this.state.playlist.length > 0;
  }

  public isFirstPlaylistItem(): boolean {
    if (!this.hasPlaylist()) return false;
    return this.state.activePlaylistIndex === 0;
  }

  public isLastPlaylistItem(): boolean {
    if (!this.hasPlaylist()) return false;
    return this.state.activePlaylistIndex === this.state.playlist.length - 1;
  }

  public next(): void {
    if (this.state.playlist.length <= 1) return;
    const nextIndex = (this.state.activePlaylistIndex + 1) % this.state.playlist.length;

    const nextSource = this.state.playlist[nextIndex];
    this.dispatchEvent('playlist-next', { index: nextIndex, source: nextSource });

    this.loadPlaylistItem(nextIndex, false);
  }

  public previous(): void {
    if (this.state.playlist.length <= 1) return;

    let prevIndex: number;
    if (this.historyStack.length > 0) {
      prevIndex = this.historyStack.pop()!;
    } else {
      prevIndex =
        (this.state.activePlaylistIndex - 1 + this.state.playlist.length) %
        this.state.playlist.length;
    }

    const prevSource = this.state.playlist[prevIndex];
    this.dispatchEvent('playlist-previous', { index: prevIndex, source: prevSource });

    this.loadPlaylistItem(prevIndex, true);
  }

  public appendPlaylistItem(source: PlayerSource): void {
    const newPlaylist = [...this.state.playlist, source];
    this.hasDispatchedNearEndForCurrentBoundary = false;
    this.updateState({ playlist: newPlaylist });
    this.dispatchEvent('playlist-change', { playlist: newPlaylist });
    this.dispatchEvent('playlist-item-added', { index: newPlaylist.length - 1, source });

    if (newPlaylist.length === 1) {
      this.loadPlaylistItem(0);
    } else {
      this.checkPlaylistNearEnd();
    }
  }

  public insertPlaylistItem(index: number, source: PlayerSource): void {
    if (index < 0 || index > this.state.playlist.length) return;
    this.hasDispatchedNearEndForCurrentBoundary = false;
    const targetIndex = index;
    const newPlaylist = [...this.state.playlist];
    newPlaylist.splice(targetIndex, 0, source);

    let nextIndex = this.state.activePlaylistIndex;
    if (newPlaylist.length > 1 && targetIndex <= this.state.activePlaylistIndex) {
      nextIndex = this.state.activePlaylistIndex + 1;
    }

    const indexChanged = nextIndex !== this.state.activePlaylistIndex;

    this.historyStack = this.historyStack.map((idx) => (idx >= targetIndex ? idx + 1 : idx));

    this.updateState({
      playlist: newPlaylist,
      activePlaylistIndex: nextIndex,
    });
    this.dispatchEvent('playlist-change', { playlist: newPlaylist });
    this.dispatchEvent('playlist-item-added', { index: targetIndex, source });

    if (newPlaylist.length === 1) {
      this.loadPlaylistItem(0, true);
    } else {
      if (indexChanged) {
        this.dispatchEvent('playlist-index-change', {
          index: nextIndex,
          source: newPlaylist[nextIndex],
        });
      }
      this.checkPlaylistNearEnd();
    }
  }

  public removePlaylistItem(index: number): void {
    if (index < 0 || index >= this.state.playlist.length) return;
    this.hasDispatchedNearEndForCurrentBoundary = false;

    const removedSource = this.state.playlist[index];
    const isRemovingCurrent = index === this.state.activePlaylistIndex;
    const wasPlaying = this.state.isPlaying;
    const newPlaylist = [...this.state.playlist];
    newPlaylist.splice(index, 1);

    this.historyStack = this.historyStack
      .filter((idx) => idx !== index)
      .map((idx) => (idx > index ? idx - 1 : idx));

    if (newPlaylist.length === 0) {
      this.updateState({
        playlist: [],
        activePlaylistIndex: 0,
      });
      this.historyStack = [];
      this.dispatchEvent('playlist-change', { playlist: [] });
      this.dispatchEvent('playlist-item-removed', { index, source: removedSource });
      this.dispatchEvent('playlist-cleared');
      this.host.loadSource({ src: '' });
      this.checkPlaylistNearEnd();
      return;
    }

    let nextIndex = this.state.activePlaylistIndex;
    if (isRemovingCurrent) {
      nextIndex = index >= newPlaylist.length ? 0 : index;
    } else if (index < this.state.activePlaylistIndex) {
      nextIndex = this.state.activePlaylistIndex - 1;
    }

    nextIndex = Math.max(0, Math.min(nextIndex, newPlaylist.length - 1));

    const indexChanged = nextIndex !== this.state.activePlaylistIndex;

    this.updateState({
      playlist: newPlaylist,
      activePlaylistIndex: nextIndex,
    });
    this.dispatchEvent('playlist-change', { playlist: newPlaylist });
    this.dispatchEvent('playlist-item-removed', { index, source: removedSource });

    if (isRemovingCurrent) {
      this.loadPlaylistItem(nextIndex, true);
      if (wasPlaying) {
        this.host.play();
      }
    } else {
      if (indexChanged) {
        this.dispatchEvent('playlist-index-change', {
          index: nextIndex,
          source: newPlaylist[nextIndex],
        });
      }
      this.checkPlaylistNearEnd();
    }
  }

  public clearPlaylist(): void {
    if (this.state.playlist.length === 0) return;
    this.originalPlaylist = null;
    this.hasDispatchedNearEndForCurrentBoundary = false;
    this.historyStack = [];
    this.updateState({
      playlist: [],
      activePlaylistIndex: 0,
    });
    this.dispatchEvent('playlist-change', { playlist: [] });
    this.dispatchEvent('playlist-cleared');
    this.host.loadSource({ src: '' });
    this.checkPlaylistNearEnd();
  }

  public replacePlaylistItem(index: number, source: PlayerSource): void {
    if (index < 0 || index >= this.state.playlist.length) return;
    this.hasDispatchedNearEndForCurrentBoundary = false;
    const newPlaylist = [...this.state.playlist];
    newPlaylist[index] = source;

    const isReplacingCurrent = index === this.state.activePlaylistIndex;
    const wasPlaying = this.state.isPlaying;

    this.updateState({ playlist: newPlaylist });
    this.dispatchEvent('playlist-change', { playlist: newPlaylist });
    this.dispatchEvent('playlist-item-replaced', { index, source });

    if (isReplacingCurrent) {
      this.loadPlaylistItem(index, true);
      if (wasPlaying) {
        this.host.play();
      }
    } else {
      this.checkPlaylistNearEnd();
    }
  }

  public movePlaylistItem(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.state.playlist.length) return;
    if (toIndex < 0 || toIndex >= this.state.playlist.length) return;
    if (fromIndex === toIndex) return;
    this.hasDispatchedNearEndForCurrentBoundary = false;

    const newPlaylist = [...this.state.playlist];
    const [movedItem] = newPlaylist.splice(fromIndex, 1);
    newPlaylist.splice(toIndex, 0, movedItem);

    const activeIndex = this.state.activePlaylistIndex;
    let nextIndex = activeIndex;

    if (activeIndex === fromIndex) {
      nextIndex = toIndex;
    } else {
      if (fromIndex < activeIndex && activeIndex <= toIndex) {
        nextIndex = activeIndex - 1;
      } else if (toIndex <= activeIndex && activeIndex < fromIndex) {
        nextIndex = activeIndex + 1;
      }
    }

    const indexChanged = nextIndex !== activeIndex;

    this.historyStack = this.historyStack.map((idx) => {
      if (idx === fromIndex) {
        return toIndex;
      }
      if (fromIndex < idx && idx <= toIndex) {
        return idx - 1;
      }
      if (toIndex <= idx && idx < fromIndex) {
        return idx + 1;
      }
      return idx;
    });

    this.updateState({
      playlist: newPlaylist,
      activePlaylistIndex: nextIndex,
    });
    this.dispatchEvent('playlist-change', { playlist: newPlaylist });
    this.dispatchEvent('playlist-item-moved', { fromIndex, toIndex, source: movedItem });

    if (indexChanged) {
      const activeSource = newPlaylist[nextIndex];
      this.dispatchEvent('playlist-index-change', {
        index: nextIndex,
        source: activeSource,
      });
    }

    this.checkPlaylistNearEnd();
  }

  private loadPlaylistItem(index: number, isPrevNavigation: boolean = false): void {
    if (index < 0 || index >= this.state.playlist.length) return;

    const oldIndex = this.state.activePlaylistIndex;

    this.updateState({ activePlaylistIndex: index });
    const source = this.state.playlist[index];
    this.dispatchEvent('playlist-index-change', { index, source });

    if (!isPrevNavigation && oldIndex !== index) {
      this.historyStack.push(oldIndex);
    }

    this.host.loadSource(source, false);
    this.checkPlaylistNearEnd();
  }

  public setPlaylistRepeatMode(mode: 'off' | 'repeat-all'): void {
    if (mode === 'off' || mode === 'repeat-all') {
      this.updateState({ playlistRepeatMode: mode });
      this.dispatchEvent('playlist-repeat-change', { repeatMode: mode });
    }
  }

  public getPlaylistRepeatMode(): 'off' | 'repeat-all' {
    return this.state.playlistRepeatMode;
  }

  public getAutoAdvanceIndexOnEnded(): number | null {
    if (this.state.loop && this.state.displayMode !== 'vertical') {
      return null;
    }
    if (this.state.playlist.length <= 1) {
      return null;
    }
    const isLast = this.isLastPlaylistItem();
    if (!isLast) {
      return (this.state.activePlaylistIndex + 1) % this.state.playlist.length;
    }
    if (this.state.playlistRepeatMode === 'repeat-all' || this.state.displayMode === 'vertical') {
      const loopPlaylist = this.host.config?.vertical?.loopPlaylist !== false;
      if (this.state.displayMode === 'vertical' && !loopPlaylist) {
        return null;
      }
      return 0;
    }
    return null;
  }

  private checkPlaylistNearEnd(): void {
    if (!this.hasPlaylist()) {
      this.hasDispatchedNearEndForCurrentBoundary = false;
      return;
    }
    const length = this.getPlaylistLength();
    const currentIndex = this.getCurrentPlaylistIndex();

    const maxThreshold = Math.max(1, length);
    const clampedThreshold = Math.max(1, Math.min(this.nearEndThreshold, maxThreshold));
    const remainingItems = length - 1 - currentIndex;

    if (remainingItems <= clampedThreshold) {
      if (!this.hasDispatchedNearEndForCurrentBoundary) {
        this.hasDispatchedNearEndForCurrentBoundary = true;
        this.dispatchEvent('playlist-near-end', {
          index: currentIndex,
          length,
          remainingItems,
          threshold: clampedThreshold,
        });
      }
    } else {
      this.hasDispatchedNearEndForCurrentBoundary = false;
    }
  }

  /**
   * Called by `PlayerController.loadSource()` when a standalone source replaces
   * an active playlist. Mirrors the previous inline block exactly.
   */
  public clearForExternalSourceLoad(): void {
    this.originalPlaylist = null;
    this.updateState({
      playlist: [],
      activePlaylistIndex: 0,
    });
    this.historyStack = [];
    this.dispatchEvent('playlist-change', { playlist: [] });
    this.dispatchEvent('playlist-cleared');
  }

  public destroy(): void {
    this.originalPlaylist = null;
    this.historyStack = [];
    this.hasDispatchedNearEndForCurrentBoundary = false;
  }
}
