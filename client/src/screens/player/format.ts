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

/** OSD subtitle line: "第 N 集·<name>", or just the name when it already reads like "第N集". */
export function episodeLabel(index: number, name: string): string {
  if (/^第\s*\d+\s*[集话期]$/.test(name.trim())) return name;
  return name ? `第 ${index + 1} 集·${name}` : `第 ${index + 1} 集`;
}

const CHINESE = new Set(['zh', 'chi', 'zho', 'cmn']);
const LANGUAGES: Record<string, string> = {
  yue: '粤语',
  en: '英语',
  eng: '英语',
  ja: '日语',
  jpn: '日语',
  ko: '韩语',
  kor: '韩语',
  fr: '法语',
  fra: '法语',
  fre: '法语',
  de: '德语',
  deu: '德语',
  ger: '德语',
  es: '西班牙语',
  spa: '西班牙语',
  ru: '俄语',
  rus: '俄语',
  th: '泰语',
  tha: '泰语',
};
const UNDEFINED = new Set(['', 'und', 'unknown']);
/** A bare ISO 639 code with optional script/region subtags, e.g. "en", "chi", "zh-Hant-TW". */
const LANGUAGE_CODE = /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i;

function languageName(code: string): string | undefined {
  const [base = '', ...subtags] = code.trim().toLowerCase().split(/[-_]/);
  if (CHINESE.has(base)) {
    if (subtags.some((tag) => ['hant', 'tw', 'hk', 'mo'].includes(tag))) return '繁体中文';
    if (subtags.some((tag) => ['hans', 'cn', 'sg'].includes(tag))) return '简体中文';
    return '中文';
  }
  return LANGUAGES[base];
}

/**
 * Human label of an audio/text track: the engine's name unless it is only a language code,
 * else the language in Chinese; undefined when nothing meaningful is known ("und", empty).
 */
export function trackLabel(track: { label?: string; language?: string }): string | undefined {
  const codes = [track.label?.trim() ?? '', track.language?.trim() ?? ''];
  const [label] = codes;
  if (label && !LANGUAGE_CODE.test(label) && !UNDEFINED.has(label.toLowerCase())) return label;
  for (const code of codes) {
    const name = languageName(code);
    if (name) return name;
  }
  // An unmapped code still beats nothing.
  return codes.find((code) => !UNDEFINED.has(code.toLowerCase()));
}
