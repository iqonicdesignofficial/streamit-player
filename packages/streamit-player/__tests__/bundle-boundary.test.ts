import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Dependency and Runtime Boundary Guarantee for streamit-player/core', () => {
  const distDir = path.resolve(__dirname, '../dist');
  const coreEsmPath = path.join(distDir, 'core/index.js');
  const coreCjsPath = path.join(distDir, 'core/index.cjs');

  // Helper function to recursively collect all local chunk dependencies
  function getTransitiveChunks(entryPath: string, isEsm: boolean): string[] {
    const visited = new Set<string>();
    const queue = [entryPath];

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      if (visited.has(currentPath)) continue;
      visited.add(currentPath);

      if (!fs.existsSync(currentPath)) continue;
      const content = fs.readFileSync(currentPath, 'utf8');

      if (isEsm) {
        // Find import/export ... from './...' or '../...'
        const importMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
        for (const match of importMatches) {
          const specifier = match[1];
          if (specifier.startsWith('.')) {
            const resolved = path.resolve(path.dirname(currentPath), specifier);
            if (!visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
      } else {
        // Find require('./...') or require('../...')
        const requireMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
        for (const match of requireMatches) {
          const specifier = match[1];
          if (specifier.startsWith('.')) {
            const resolved = path.resolve(path.dirname(currentPath), specifier);
            if (!visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
      }
    }

    return Array.from(visited);
  }

  it('dist/core/index.js exists and has content', () => {
    expect(fs.existsSync(coreEsmPath)).toBe(true);
    const content = fs.readFileSync(coreEsmPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('complete transitive ESM chunk graph for core contains ZERO Lit, @lit, or UI code', () => {
    const reachableChunks = getTransitiveChunks(coreEsmPath, true);
    expect(reachableChunks.length).toBeGreaterThan(0);

    for (const chunkPath of reachableChunks) {
      const filename = path.basename(chunkPath);
      const content = fs.readFileSync(chunkPath, 'utf8');

      // 1. Must not import lit packages
      expect(content).not.toMatch(/from\s*['"]lit['"]/);
      expect(content).not.toMatch(/from\s*['"]lit\/decorators/);
      expect(content).not.toMatch(/from\s*['"]@lit/);

      // 2. Must not contain LitElement or custom element registration
      expect(content).not.toContain('LitElement');
      expect(content).not.toContain('customElements.define');

      // 3. Must not reference Web Component UI classes or tags
      expect(content).not.toContain('PlayerPlayer');
      expect(content).not.toContain('PlayerPlayButton');
      expect(content).not.toContain('PlayerSeekbar');
      expect(content).not.toContain('PlayerVolumeControl');
      expect(content).not.toContain('streamit-player');
      expect(content).not.toContain('player-player');

      // 4. Must not be the Player UI chunk
      expect(filename).not.toMatch(/^Player-[A-Za-z0-9_-]+\.js$/);
    }
  });

  it('complete transitive CommonJS chunk graph for core contains ZERO Lit or UI code', () => {
    if (fs.existsSync(coreCjsPath)) {
      const reachableChunks = getTransitiveChunks(coreCjsPath, false);
      expect(reachableChunks.length).toBeGreaterThan(0);

      for (const chunkPath of reachableChunks) {
        const filename = path.basename(chunkPath);
        const content = fs.readFileSync(chunkPath, 'utf8');

        // 1. Must not require lit
        expect(content).not.toMatch(/require\(['"]lit['"]\)/);
        expect(content).not.toMatch(/require\(['"]lit\/decorators/);
        expect(content).not.toMatch(/require\(['"]@lit/);

        // 2. Must not contain LitElement or custom element registration
        expect(content).not.toContain('LitElement');
        expect(content).not.toContain('customElements.define');

        // 3. Must not reference Web Component UI classes
        expect(content).not.toContain('PlayerPlayer');
        expect(filename).not.toMatch(/^Player-[A-Za-z0-9_-]+\.cjs$/);
      }
    }
  });

  it('dist/core exports headless PlayerController and playback utilities', () => {
    const content = fs.readFileSync(coreEsmPath, 'utf8');
    expect(content).toContain('PlayerController');
    expect(content).toContain('TimelineMath');
    expect(content).toContain('formatTime');
    expect(content).toContain('DrmManager');
    expect(content).toContain('AdsManager');
  });
});
