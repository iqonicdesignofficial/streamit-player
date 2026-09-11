import { describe, it, expect } from 'vitest';
import { TimelineMath } from './TimelineMath';
import { TimelineMarker, Chapter } from './types';

describe('TimelineMath', () => {
  it('timeToPercent maps mid-range time to 50%', () => {
    expect(TimelineMath.timeToPercent(5, 0, 10)).toBe(50);
  });
  it('timeToPercent clamps below start to 0', () => {
    expect(TimelineMath.timeToPercent(-5, 0, 10)).toBe(0);
  });
  it('timeToPercent clamps above end to 100', () => {
    expect(TimelineMath.timeToPercent(15, 0, 10)).toBe(100);
  });
  it('timeToPercent returns 0 when range is zero or negative', () => {
    expect(TimelineMath.timeToPercent(5, 10, 10)).toBe(0);
    expect(TimelineMath.timeToPercent(5, 10, 5)).toBe(0);
  });
  it('percentToTime covers 0%, 50%, 100% and non-zero start cases', () => {
    expect(TimelineMath.percentToTime(0, 0, 10)).toBe(0);
    expect(TimelineMath.percentToTime(50, 0, 10)).toBe(5);
    expect(TimelineMath.percentToTime(100, 0, 10)).toBe(10);
    expect(TimelineMath.percentToTime(50, 5, 15)).toBe(10);
  });
  it('clampToSeekable clamps both directions', () => {
    expect(TimelineMath.clampToSeekable(-1, 0, 10)).toBe(0);
    expect(TimelineMath.clampToSeekable(11, 0, 10)).toBe(10);
    expect(TimelineMath.clampToSeekable(5, 0, 10)).toBe(5);
  });
  it('isMarkerVisible / isWithinSeekable agree on boundary inclusivity', () => {
    expect(TimelineMath.isMarkerVisible(0, 0, 10)).toBe(true);
    expect(TimelineMath.isMarkerVisible(10, 0, 10)).toBe(true);
    expect(TimelineMath.isMarkerVisible(10.01, 0, 10)).toBe(false);
    // Direct assertions for isWithinSeekable
    expect(TimelineMath.isWithinSeekable(0, 0, 10)).toBe(true);
    expect(TimelineMath.isWithinSeekable(10, 0, 10)).toBe(true);
    expect(TimelineMath.isWithinSeekable(10.01, 0, 10)).toBe(false);
  });
  it('shouldPruneMarker is true only when marker precedes seekable start', () => {
    expect(TimelineMath.shouldPruneMarker(-1, 0)).toBe(true);
    expect(TimelineMath.shouldPruneMarker(0, 0)).toBe(false);
  });

  describe('findNearestMarker', () => {
    const markers: TimelineMarker[] = [
      { id: '1', time: 5, label: 'Ad 1', type: 'ad', color: '#ff0000' },
      { id: '2', time: 15, label: 'Bookmark 1', type: 'bookmark', color: '#00ff00' },
      { id: '3', time: 25, label: 'Metadata 1', type: 'metadata' },
    ];

    it('returns null for empty markers array', () => {
      expect(TimelineMath.findNearestMarker(10, [], null, 5)).toBeNull();
    });

    it('returns null when no markers within threshold', () => {
      expect(TimelineMath.findNearestMarker(50, markers, null, 5)).toBeNull();
    });

    it('finds nearest marker within threshold', () => {
      const result = TimelineMath.findNearestMarker(6, markers, null, 2);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('1');
      expect(result?.time).toBe(5);
    });

    it('respects visibleMarkerTypes filter', () => {
      const result = TimelineMath.findNearestMarker(6, markers, ['bookmark'], 5);
      expect(result).toBeNull();
    });

    it('respects visibleMarkerTypes filter and finds matching type', () => {
      const result = TimelineMath.findNearestMarker(16, markers, ['bookmark', 'ad'], 2);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('2');
    });

    it('finds nearest among multiple markers within threshold', () => {
      const multiMarkers: TimelineMarker[] = [
        { id: '1', time: 8, label: 'M1', type: 'ad' },
        { id: '2', time: 12, label: 'M2', type: 'ad' },
      ];
      const result = TimelineMath.findNearestMarker(10, multiMarkers, null, 5);
      expect(result?.id).toBe('1');
    });
  });

  describe('findNearestChapter', () => {
    const chapters: Chapter[] = [
      { id: 'ch1', title: 'Chapter 1', startTime: 0, endTime: 30 },
      { id: 'ch2', title: 'Chapter 2', startTime: 30, endTime: 60 },
      { id: 'ch3', title: 'Chapter 3', startTime: 60 },
    ];

    it('returns -1 for empty chapters array', () => {
      expect(TimelineMath.findNearestChapter(10, [], 120)).toBe(-1);
    });

    it('finds chapter containing given time', () => {
      expect(TimelineMath.findNearestChapter(15, chapters, 120)).toBe(0);
      expect(TimelineMath.findNearestChapter(45, chapters, 120)).toBe(1);
    });

    it('finds chapter at exact start boundary', () => {
      expect(TimelineMath.findNearestChapter(0, chapters, 120)).toBe(0);
      expect(TimelineMath.findNearestChapter(30, chapters, 120)).toBe(1);
    });

    it('uses implicit end time from next chapter when endTime is undefined', () => {
      expect(TimelineMath.findNearestChapter(75, chapters, 120)).toBe(2);
    });

    it('returns -1 when time is beyond all chapters', () => {
      const shortChapters: Chapter[] = [
        { id: 'ch1', title: 'Chapter 1', startTime: 0, endTime: 30 },
      ];
      expect(TimelineMath.findNearestChapter(50, shortChapters, 120)).toBe(-1);
    });
  });

  describe('findNearestChapterBoundary', () => {
    const chapters: Chapter[] = [
      { id: 'ch1', title: 'Chapter 1', startTime: 0, endTime: 30 },
      { id: 'ch2', title: 'Chapter 2', startTime: 30, endTime: 60 },
      { id: 'ch3', title: 'Chapter 3', startTime: 60 },
    ];

    it('returns null for empty chapters array', () => {
      expect(TimelineMath.findNearestChapterBoundary(10, [], 5)).toBeNull();
    });

    it('finds chapter at exact boundary', () => {
      const result = TimelineMath.findNearestChapterBoundary(0, chapters, 5);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ch1');
    });

    it('finds nearest chapter boundary within threshold', () => {
      const result = TimelineMath.findNearestChapterBoundary(32, chapters, 5);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ch2');
    });

    it('returns null when no boundaries within threshold', () => {
      expect(TimelineMath.findNearestChapterBoundary(45, chapters, 5)).toBeNull();
    });

    it('finds nearest boundary when multiple chapters nearby', () => {
      const result = TimelineMath.findNearestChapterBoundary(31, chapters, 2);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ch2');
    });
  });
});
