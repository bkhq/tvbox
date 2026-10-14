/** A remarks value that is only a zero score, e.g. "评分：0" from the 豆瓣 source. */
const ZERO_SCORE = /^评分[：:]\s*0(\.0+)?$/;

/** vod_remarks for display: undefined when empty or only a zero score, else trimmed. */
export function displayRemarks(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || ZERO_SCORE.test(trimmed)) return undefined;
  return trimmed;
}
