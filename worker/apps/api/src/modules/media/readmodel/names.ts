// Chinese display names for the ISO codes the catalog stores. A code missing
// here is shown as itself.

const COUNTRIES: Record<string, string> = {
  CN: "中国大陆",
  HK: "中国香港",
  TW: "中国台湾",
  MO: "中国澳门",
  US: "美国",
  GB: "英国",
  JP: "日本",
  KR: "韩国",
  TH: "泰国",
  IN: "印度",
  FR: "法国",
  DE: "德国",
  IT: "意大利",
  ES: "西班牙",
  CA: "加拿大",
  AU: "澳大利亚",
  RU: "俄罗斯",
  SG: "新加坡",
  MY: "马来西亚",
  PH: "菲律宾",
  VN: "越南",
  ID: "印度尼西亚",
  BR: "巴西",
  MX: "墨西哥",
  SE: "瑞典",
  DK: "丹麦",
  NO: "挪威",
  NZ: "新西兰",
  IE: "爱尔兰",
  BE: "比利时",
  NL: "荷兰",
  TR: "土耳其",
};

const LANGUAGES: Record<string, string> = {
  zh: "汉语",
  yue: "粤语",
  en: "英语",
  ja: "日语",
  ko: "韩语",
  th: "泰语",
  hi: "印地语",
  fr: "法语",
  de: "德语",
  it: "意大利语",
  es: "西班牙语",
  ru: "俄语",
  pt: "葡萄牙语",
  vi: "越南语",
  id: "印尼语",
  ms: "马来语",
  tr: "土耳其语",
};

export function countryName(code: string): string {
  return COUNTRIES[code] ?? code;
}

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code;
}
