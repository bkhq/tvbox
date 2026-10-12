import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { getServerLink, type ServerLink, type ServerLinkState } from './serverLink';

export interface UseServerLink {
  state: ServerLinkState;
  code: string;
  subscription: string;
  request(): Promise<void>;
  refresh(): Promise<void>;
  unlink(): Promise<void>;
}

/** Subscribes a component to the server link state; initialises the link on first use. */
export function useServerLink(link: ServerLink = getServerLink()): UseServerLink {
  const snapshot = useSyncExternalStore(
    useCallback((onChange: () => void) => link.subscribe(onChange), [link]),
    () => link.getSnapshot(),
  );
  useEffect(() => {
    void link.init();
  }, [link]);
  return {
    ...snapshot,
    request: useCallback(() => link.request(), [link]),
    refresh: useCallback(() => link.refresh(), [link]),
    unlink: useCallback(() => link.unlink(), [link]),
  };
}
