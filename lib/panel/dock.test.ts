// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canDock,
  clampDockWidth,
  DOCK_WIDTH,
  dock,
  isDocked,
  MIN_PAGE_WIDTH,
  releaseDock,
  undock,
} from './dock';

afterEach(() => {
  undock(document);
  vi.useRealTimers();
});

describe('clampDockWidth', () => {
  it('keeps the width between the limits', () => {
    expect(clampDockWidth(100, 1920)).toBe(DOCK_WIDTH.min);
    expect(clampDockWidth(5000, 1920)).toBe(DOCK_WIDTH.max);
    expect(clampDockWidth(412.4, 1920)).toBe(412);
  });

  it('leaves the portal its minimum width in a smaller window', () => {
    expect(clampDockWidth(600, 1100)).toBe(1100 - MIN_PAGE_WIDTH);
  });

  it('falls back to the default for a stored value that is not a number', () => {
    expect(clampDockWidth(Number.NaN, 1920)).toBe(DOCK_WIDTH.default);
  });
});

describe('canDock', () => {
  it('needs room for the portal and the narrowest sidebar', () => {
    expect(canDock(MIN_PAGE_WIDTH + DOCK_WIDTH.min)).toBe(true);
    expect(canDock(MIN_PAGE_WIDTH + DOCK_WIDTH.min - 1)).toBe(false);
  });
});

describe('dock and undock', () => {
  it('narrows the page and puts everything back', () => {
    const onResize = vi.fn();
    window.addEventListener('resize', onResize);
    dock(document, 400);
    expect(isDocked(document)).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--azinfo-dock-width')).toBe('400px');
    expect(document.getElementById('azinfo-dock-style')).toBeTruthy();
    // Same width again: nothing for the portal to lay out.
    dock(document, 400);
    expect(onResize).toHaveBeenCalledTimes(1);

    undock(document);
    expect(isDocked(document)).toBe(false);
    expect(document.documentElement.hasAttribute('style')).toBe(false);
    expect(document.getElementById('azinfo-dock-style')).toBeNull();
    expect(onResize).toHaveBeenCalledTimes(2);
    window.removeEventListener('resize', onResize);
  });

  it('keeps the page docked when a new panel docks right after the old one releases', () => {
    vi.useFakeTimers();
    dock(document, 400);
    releaseDock(document);
    dock(document, 400);
    vi.runAllTimers();
    expect(isDocked(document)).toBe(true);

    releaseDock(document);
    vi.runAllTimers();
    expect(isDocked(document)).toBe(false);
  });
});
