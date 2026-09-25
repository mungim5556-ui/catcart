/**
 * Phones: keep the page at 1× zoom. iOS Safari ignores `user-scalable=no`, so a double tap or a
 * pinch could zoom into the game with no way back. Block those gestures, and if the page ends up
 * zoomed anyway, snap it back by re-applying the viewport.
 */
export function preventZoom(): void {
  // iOS pinch gestures.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  // Two-finger moves that aren't on a game button (buttons track their own fingers).
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // Double tap on anything that isn't a clickable control.
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      const target = e.target as Element | null;
      const control = target?.closest('button, a, input, select, label, [data-action], [data-result], [data-cer]');
      if (now - lastEnd < 350 && !control) e.preventDefault();
      lastEnd = now;
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // Recovery: if the view is zoomed in anyway, reset the viewport meta to force 1×.
  const vv = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (vv && meta) {
    const content = meta.content;
    vv.addEventListener('resize', () => {
      if (vv.scale <= 1.01) return;
      meta.content = content.replace('maximum-scale=1.0', 'maximum-scale=1.01');
      requestAnimationFrame(() => (meta.content = content));
      window.scrollTo(0, 0);
    });
  }
}
