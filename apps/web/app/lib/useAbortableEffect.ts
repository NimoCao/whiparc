'use client';

import { useEffect, type DependencyList } from 'react';

// Runs `effect` with an AbortSignal that is aborted on cleanup (deps change
// or unmount). Pass the signal into `fetch()` calls so a superseded request
// is actually cancelled instead of racing a newer one and overwriting state
// with stale data — see https://github.com/whiparc/whiparc/issues/101.
export function useAbortableEffect(effect: (signal: AbortSignal) => void, deps: DependencyList) {
  useEffect(() => {
    const controller = new AbortController();
    effect(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
