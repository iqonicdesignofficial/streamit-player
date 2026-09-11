import { TimelineMarker, Chapter } from './types';

export class TimelineMath {
  public static timeToPercent(time: number, start: number, end: number): number {
    const range = end - start;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(((time - start) / range) * 100, 100));
  }

  public static percentToTime(percent: number, start: number, end: number): number {
    const range = end - start;
    return start + (percent / 100) * range;
  }

  public static clampToSeekable(time: number, start: number, end: number): number {
    return Math.max(start, Math.min(time, end));
  }

  public static isMarkerVisible(markerTime: number, start: number, end: number): boolean {
    return markerTime >= start && markerTime <= end;
  }

  public static isWithinSeekable(time: number, start: number, end: number): boolean {
    return time >= start && time <= end;
  }

  public static shouldPruneMarker(markerTime: number, start: number): boolean {
    return markerTime < start;
  }

  public static findNearestMarker(
    time: number,
    markers: TimelineMarker[],
    visibleMarkerTypes: string[] | null,
    hoverThreshold: number
  ): TimelineMarker | null {
    if (!markers || markers.length === 0) return null;
    let nearestMarker: TimelineMarker | null = null;
    let minDiff = Infinity;
    for (const m of markers) {
      if (visibleMarkerTypes && !visibleMarkerTypes.includes(m.type)) {
        continue;
      }
      const diff = Math.abs(m.time - time);
      if (diff < minDiff && diff <= hoverThreshold) {
        minDiff = diff;
        nearestMarker = m;
      }
    }
    return nearestMarker;
  }

  public static findNearestChapter(time: number, chapters: Chapter[], duration: number): number {
    if (!chapters || chapters.length === 0) return -1;
    return chapters.findIndex((c, idx) => {
      const start = c.startTime;
      const end =
        c.endTime !== undefined
          ? c.endTime
          : chapters[idx + 1]
            ? chapters[idx + 1].startTime
            : duration || Infinity;
      return time >= start && time < end;
    });
  }

  public static findNearestChapterBoundary(
    time: number,
    chapters: Chapter[],
    hoverThreshold: number
  ): Chapter | null {
    if (!chapters || chapters.length === 0) return null;
    let nearestChapter: Chapter | null = null;
    let minDiff = Infinity;
    for (const ch of chapters) {
      const diff = Math.abs(ch.startTime - time);
      if (diff < minDiff && diff <= hoverThreshold) {
        minDiff = diff;
        nearestChapter = ch;
      }
    }
    return nearestChapter;
  }
}
