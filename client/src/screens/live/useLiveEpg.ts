import { useCallback, useEffect, useRef, useState } from 'react';

import type { Channel, Group, Live } from '../../core/types';
import {
  channelTvgId,
  dateInZone,
  type Epg,
  epgXmlUrls,
  fetchChannelEpg,
  loadXmltv,
  type XmltvData,
  xmltvEpgs,
} from '../../player/live';

export interface LiveEpg {
  /** Today's programmes of the channel, when loaded. */
  epgFor(channel: Channel): Epg | undefined;
  /** Channel logo, else the XMLTV icon. */
  logoOf(channel: Channel): string;
  /** LiveViewModel.getEpg: loads the channel's `{date}` EPG once if XMLTV has none. */
  request(channel: Channel): void;
}

/**
 * Programme guide of a live source: the XMLTV files of `live.epg` once per
 * source (LiveApi.parseXml), and per-channel EPG URLs on demand.
 */
export function useLiveEpg(live: Live, groups: Group[]): LiveEpg {
  const [xmltv, setXmltv] = useState<XmltvData | undefined>(undefined);
  const [fetched, setFetched] = useState<Record<string, Epg[]>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (epgXmlUrls(live).length === 0) return;
    const controller = new AbortController();
    loadXmltv(live, groups, { signal: controller.signal }).then(
      ({ ok, data }) => {
        if (ok && !controller.signal.aborted) setXmltv(data);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [live, groups]);

  const epgs = useCallback(
    (channel: Channel) => (xmltv ? xmltvEpgs(xmltv, channel) : []).concat(fetched[channelTvgId(channel)] ?? []),
    [xmltv, fetched],
  );

  const epgFor = useCallback(
    (channel: Channel) => {
      const today = dateInZone(Date.now(), live.timeZone);
      return epgs(channel).find((epg) => epg.date === today);
    },
    [epgs, live.timeZone],
  );

  const logoOf = useCallback(
    (channel: Channel) => channel.logo || (xmltv?.logos[channelTvgId(channel)] ?? ''),
    [xmltv],
  );

  const request = useCallback(
    (channel: Channel) => {
      const key = channelTvgId(channel);
      if (!channel.epg.startsWith('http') || requested.current.has(key)) return;
      if (xmltv && xmltvEpgs(xmltv, channel).length > 0) return;
      requested.current.add(key);
      fetchChannelEpg(channel, live.timeZone).then(
        ({ list }) => setFetched((current) => ({ ...current, [key]: list })),
        () => requested.current.delete(key),
      );
    },
    [xmltv, live.timeZone],
  );

  return { epgFor, logoOf, request };
}
