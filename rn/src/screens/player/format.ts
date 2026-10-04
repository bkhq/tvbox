/** Milliseconds as mm:ss, or h:mm:ss from one hour on. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function formatSpeed(speed: number): string {
  return `${speed}x`;
}

/** Display name of an external subtitle URL: its file name, else a generic label. */
export function subtitleName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  return name || '外挂字幕';
}
