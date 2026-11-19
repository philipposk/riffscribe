/**
 * The studio needs cross-origin isolation (SharedArrayBuffer for Demucs), which the
 * server grants per *document* on /studio only. Reaching the studio through a
 * client-side route change from a page without it keeps that page's document, so
 * the studio would run without isolation. A reload fetches /studio fresh.
 *
 * `initialPath` is where the document was first loaded; if it is not the current
 * path we got here client-side. After the reload they match, so it happens once.
 */
export function needsIsolatedReload(opts: {
  isolated: boolean;
  initialPath: string;
  currentPath: string;
}): boolean {
  return !opts.isolated && opts.initialPath !== opts.currentPath;
}

/** Browser wrapper: false anywhere the navigation entry cannot be read. */
export function studioNeedsReload(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return false;
    return needsIsolatedReload({
      isolated: window.crossOriginIsolated === true,
      initialPath: new URL(nav.name).pathname,
      currentPath: location.pathname,
    });
  } catch {
    return false;
  }
}

/**
 * Google's sign-in popup posts its credential back through window.opener, which
 * `same-origin` COOP (the studio) severs. FedCM (Chrome) does not use the popup.
 * Where the page is isolated and FedCM is missing, use the redirect sign-in instead.
 */
export function googlePopupUsable(opts: { isolated: boolean; fedcm: boolean }): boolean {
  return !opts.isolated || opts.fedcm;
}

export function googlePopupUsableHere(): boolean {
  return googlePopupUsable({
    isolated: window.crossOriginIsolated === true,
    fedcm: "IdentityCredential" in window,
  });
}
