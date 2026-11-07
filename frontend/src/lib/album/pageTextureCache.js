/**
 * Keeps a bounded number of page textures alive, so a thirty-photo album uses the
 * same GPU memory as a five-photo one. Pages in use are held with acquire/release.
 * Unused ones stay around, least recently used dropped first, so that turning back
 * a page is instant. Artwork is drawn one at a time so that uploads don't stall a turn.
 */
import * as THREE from 'three';
import { composePage } from './pageArtwork.js';

const MAX_UNUSED = 8;

export class PageTextureCache {
  constructor(loadBitmap, paper) {
    this.loadBitmap = loadBitmap;
    this.paper = paper;
    this.entries = new Map();
    this.queue = [];
    this.busy = false;
    this.renderer = null;
    this.destroyed = false;
  }

  setRenderer(renderer) {
    this.renderer = renderer;
  }

  /**
   * Registers interest in a page. `onReady({map, roughnessMap})` is called now if
   * the page is finished, otherwise when it is. Returns the release function.
   */
  acquire(desc, onReady) {
    const entry = this.entry(desc, true);
    entry.refs += 1;
    entry.lastUsed = performance.now();
    if (entry.textures) onReady(entry.textures);
    else entry.waiting.add(onReady);
    return () => {
      entry.waiting.delete(onReady);
      entry.refs -= 1;
      entry.lastUsed = performance.now();
      this.evict();
    };
  }

  /** Prepares a page ahead of time without holding on to it. */
  preload(desc) {
    this.entry(desc, false);
  }

  entry(desc, urgent) {
    let entry = this.entries.get(desc.key);
    if (!entry) {
      entry = { desc, refs: 0, textures: null, waiting: new Set(), lastUsed: performance.now(), queued: true };
      this.entries.set(desc.key, entry);
      if (urgent) this.queue.unshift(entry);
      else this.queue.push(entry);
      this.pump();
    } else if (urgent && entry.queued) {
      // Something on screen needs it now, so it jumps ahead of speculative work.
      const at = this.queue.indexOf(entry);
      if (at > 0) {
        this.queue.splice(at, 1);
        this.queue.unshift(entry);
      }
    }
    return entry;
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length && !this.destroyed) {
      const entry = this.queue.shift();
      entry.queued = false;
      if (this.entries.get(entry.desc.key) !== entry) continue; // evicted while queued
      try {
        const { canvas, roughCanvas } = await composePage(entry.desc, this.loadBitmap, this.paper);
        if (this.destroyed || this.entries.get(entry.desc.key) !== entry) continue;
        entry.textures = this.createTextures(canvas, roughCanvas);
        entry.waiting.forEach((fn) => fn(entry.textures));
        entry.waiting.clear();
      } catch {
        // Failed artwork leaves the blank sheet showing rather than breaking the book.
        this.entries.delete(entry.desc.key);
      }
      // Give the frame loop a turn between pages.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.busy = false;
    this.evict();
  }

  createTextures(canvas, roughCanvas) {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4;
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    // Upload right away rather than on first draw, which could fall mid-turn.
    this.renderer?.initTexture(map);
    this.renderer?.initTexture(roughnessMap);
    return { map, roughnessMap };
  }

  evict() {
    const unused = [...this.entries.values()].filter((e) => e.refs === 0 && !e.queued);
    if (unused.length <= MAX_UNUSED) return;
    unused.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of unused.slice(0, unused.length - MAX_UNUSED)) {
      this.entries.delete(entry.desc.key);
      this.disposeEntry(entry);
    }
  }

  disposeEntry(entry) {
    entry.textures?.map.dispose();
    entry.textures?.roughnessMap.dispose();
    entry.textures = null;
  }

  /**
   * Undoes destroy(). React may run an effect's cleanup and then the effect again on
   * a cache that's still in use (StrictMode does this on purpose), so destroying has to
   * be reversible, or that page's artwork would never be drawn.
   */
  revive() {
    this.destroyed = false;
    this.pump();
  }

  destroy() {
    this.destroyed = true;
    this.queue.length = 0;
    this.entries.forEach((entry) => this.disposeEntry(entry));
    this.entries.clear();
  }
}
