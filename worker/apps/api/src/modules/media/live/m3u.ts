import type { Live } from "../contract";

/**
 * M3U playlists, the format TVBox and IPTV players read live channels in.
 * Importing copies a playlist into the tables once; exporting (and the
 * Worker's `/media/live.m3u`) writes the published channels back out.
 */

export interface M3uChannel {
  readonly group: string;
  readonly name: string;
  readonly number: number | null;
  readonly tvgId: string | null;
  readonly logo: string | null;
  readonly url: string;
  readonly userAgent: string | null;
  readonly referer: string | null;
}

export interface M3uPlaylist {
  readonly epg: string[];
  readonly channels: M3uChannel[];
}

const DEFAULT_GROUP = "未分组";

function attr(line: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(line);
  return m && m[1]!.trim() !== "" ? m[1]!.trim() : null;
}

/**
 * Parse an M3U (`#EXTINF` lines) or a TVBox txt list (`group,#genre#` then
 * `name,url` lines). Anything else is skipped.
 */
export function parseM3u(text: string): M3uPlaylist {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const epg: string[] = [];
  const channels: M3uChannel[] = [];

  if (!lines[0]?.startsWith("#EXTM3U")) {
    let group = DEFAULT_GROUP;
    for (const line of lines) {
      const comma = line.indexOf(",");
      if (comma <= 0)
        continue;
      const name = line.slice(0, comma).trim();
      const rest = line.slice(comma + 1).trim();
      if (rest === "#genre#") {
        group = name;
        continue;
      }
      // `name,url1#url2`: several lines of one channel.
      for (const url of rest.split("#").map(u => u.trim()).filter(u => /^(?:https?|rtmp|rtsp|rtp|udp|p2p):\/\//i.test(u)))
        channels.push({ group, name, number: null, tvgId: null, logo: null, url, userAgent: null, referer: null });
    }
    return { epg, channels };
  }

  const header = attr(lines[0], "x-tvg-url") ?? attr(lines[0], "url-tvg");
  if (header)
    epg.push(...header.split(",").map(u => u.trim()).filter(Boolean));

  let info: Omit<M3uChannel, "url"> | null = null;
  let userAgent: string | null = null;
  let referer: string | null = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const chno = Number(attr(line, "tvg-chno"));
      info = {
        group: attr(line, "group-title") ?? DEFAULT_GROUP,
        name: (comma >= 0 ? line.slice(comma + 1).trim() : "") || attr(line, "tvg-name") || "未命名",
        number: Number.isSafeInteger(chno) && chno > 0 ? chno : null,
        tvgId: attr(line, "tvg-id"),
        logo: attr(line, "tvg-logo"),
        userAgent: attr(line, "http-user-agent"),
        referer: attr(line, "http-referrer") ?? attr(line, "http-referer"),
      };
      userAgent = null;
      referer = null;
    }
    else if (line.startsWith("#EXTVLCOPT:")) {
      const [key, ...value] = line.slice("#EXTVLCOPT:".length).split("=");
      if (key === "http-user-agent")
        userAgent = value.join("=").trim() || null;
      else if (key === "http-referrer" || key === "http-referer")
        referer = value.join("=").trim() || null;
    }
    else if (!line.startsWith("#") && info) {
      channels.push({ ...info, url: line, userAgent: userAgent ?? info.userAgent, referer: referer ?? info.referer });
      info = null;
    }
  }
  return { epg, channels };
}

const quote = (s: string) => s.replace(/"/g, "'");

/** The published channels as M3U: one entry per stream, so a player sees each line. */
export function toM3u(live: Live): string {
  const out = [live.epg.length ? `#EXTM3U x-tvg-url="${quote(live.epg.join(","))}"` : "#EXTM3U"];
  for (const group of live.groups) {
    for (const channel of group.channels) {
      const attrs = [
        channel.tvgId ? `tvg-id="${quote(channel.tvgId)}"` : null,
        channel.number !== null ? `tvg-chno="${channel.number}"` : null,
        `tvg-name="${quote(channel.name)}"`,
        channel.logo ? `tvg-logo="${quote(channel.logo)}"` : null,
        `group-title="${quote(group.name)}"`,
      ].filter(Boolean).join(" ");
      for (const stream of channel.streams) {
        out.push(`#EXTINF:-1 ${attrs},${channel.name}`);
        if (stream.headers["User-Agent"])
          out.push(`#EXTVLCOPT:http-user-agent=${stream.headers["User-Agent"]}`);
        if (stream.headers.Referer)
          out.push(`#EXTVLCOPT:http-referrer=${stream.headers.Referer}`);
        out.push(stream.url);
      }
    }
  }
  return `${out.join("\n")}\n`;
}
