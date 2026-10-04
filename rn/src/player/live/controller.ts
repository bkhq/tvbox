/**
 * Live read / select surface for LAN services (/api/source, /api/control).
 * The Live screen attaches while focused so selectChannel switches in place;
 * otherwise the Live route is opened through the registered opener.
 */

import type { Group } from '../../core/types';
import { loadLiveGroups, loadLiveSources } from './source';

export interface LiveChannelInfo {
  index: number;
  name: string;
  number: string;
  logo: string;
}

export interface LiveGroupInfo {
  index: number;
  name: string;
  channels: LiveChannelInfo[];
}

export interface LiveController {
  /** Groups of the active live source; password-protected groups are excluded. */
  listGroups(): Promise<LiveGroupInfo[]>;
  selectChannel(groupIndex: number, channelIndex: number): void;
}

/** The focused Live screen. */
export interface LiveScreenHost {
  /** The screen's visible groups (route indices), before any unlock. */
  getGroups(): Group[];
  selectChannel(groupIndex: number, channelIndex: number): void;
}

export type LiveOpener = (params: { groupIndex: number; channelIndex: number }) => void;

export interface LiveControllerHub {
  controller: LiveController;
  attachLiveScreen(host: LiveScreenHost): () => void;
  setLiveOpener(opener: LiveOpener | undefined): void;
}

export function describeGroups(groups: Group[]): LiveGroupInfo[] {
  return groups.map((group, index) => ({
    index,
    name: group.name,
    channels: group.channel.map((channel, channelIndex) => ({
      index: channelIndex,
      name: channel.name,
      number: channel.number,
      logo: channel.logo,
    })),
  }));
}

/** Visible groups of the active live source, loaded without the screen. */
async function loadVisibleGroups(): Promise<Group[]> {
  const { home } = await loadLiveSources();
  return home ? (await loadLiveGroups(home)).visible : [];
}

export function createLiveControllerHub(loadGroups: () => Promise<Group[]> = loadVisibleGroups): LiveControllerHub {
  let screen: LiveScreenHost | undefined;
  let opener: LiveOpener | undefined;
  return {
    controller: {
      listGroups: async () => describeGroups(screen ? screen.getGroups() : await loadGroups()),
      selectChannel(groupIndex, channelIndex) {
        if (!Number.isInteger(groupIndex) || !Number.isInteger(channelIndex)) return;
        if (screen) screen.selectChannel(groupIndex, channelIndex);
        else opener?.({ groupIndex, channelIndex });
      },
    },
    attachLiveScreen(host) {
      screen = host;
      return () => {
        if (screen === host) screen = undefined;
      };
    },
    setLiveOpener(next) {
      opener = next;
    },
  };
}

const shared = createLiveControllerHub();

export function getLiveController(): LiveController {
  return shared.controller;
}

/** Attaches the focused Live screen; returns the detach function. */
export function attachLiveScreen(host: LiveScreenHost): () => void {
  return shared.attachLiveScreen(host);
}

/** Registers how to open the Live route (navigation). */
export function setLiveOpener(opener: LiveOpener | undefined): void {
  shared.setLiveOpener(opener);
}
