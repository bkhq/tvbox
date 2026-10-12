const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  emsp: ' ',
  ensp: ' ',
  thinsp: ' ',
  copy: '©',
  reg: '®',
  times: '×',
  bull: '•',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/**
 * Util.clean: a vod_content that may be HTML as plain text. Line breaks come from <br>, </p>, </div> and <li>;
 * other tags are dropped, entities decoded, NBSP and ideographic spaces become spaces, empty lines are removed.
 */
export function htmlToText(text: string): string {
  if (!text.includes('<') && !/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/.test(text)) return text.trim();
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<li\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return decodeEntities(stripped)
    .replace(/[ 　]/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}
