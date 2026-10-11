// Address matching for finding an EXISTING Teams team/channel for a project.
// Project names are street addresses, so the leading street number is the one
// token that reliably separates two projects on the same street.

// Recall-biased: a human confirms every match, so a near-miss costs a glance
// while a missed match costs the whole feature. Keep this threshold low.
export const MIN_MATCH_SCORE = 0.3;

const STREET_NUMBER_RE = /^\d+[a-z]?$/;

// Our own decorations, stripped so an auto-created workspace still matches the
// project it belongs to (see buildTeamsNames).
const GFS_PREFIX_RE = /^gfs\s*[-–—]?\s*/;
const DISCUSSION_SUFFIX_RE = /\s+discussion$/;

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  rd: 'road',
  dr: 'drive',
  blvd: 'boulevard',
  ln: 'lane',
  ct: 'court',
  ter: 'terrace',
  terr: 'terrace',
  pl: 'place',
  pkwy: 'parkway',
  hwy: 'highway',
  cir: 'circle',
  sq: 'square',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

// Words that carry no address signal. Unit markers are dropped because
// "10208 Van Thompson Rd" and "10208 Van Thompson Rd Unit B" are the same site.
const STOPWORDS: ReadonlySet<string> = new Set([
  'gfs',
  'the',
  'and',
  'project',
  'projects',
  'team',
  'teams',
  'channel',
  'discussion',
  'apt',
  'unit',
  'ste',
  'suite',
  '#',
]);

export interface NormalizedName {
  raw: string;
  text: string;
  tokens: string[];
  streetNumber: string | null;
}

export interface ScoredItem<T> {
  item: T;
  score: number;
}

export const normalizeName = (raw: string): NormalizedName => {
  const stripped = (raw ?? '')
    .toLowerCase()
    .trim()
    .replace(GFS_PREFIX_RE, '')
    .replace(DISCUSSION_SUFFIX_RE, '');

  const words = stripped
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);

  // Street number is read BEFORE stopword removal so a leading number survives
  // even when every other token is dropped.
  const streetNumber = words.find((w) => STREET_NUMBER_RE.test(w)) ?? null;

  const tokens: string[] = [];
  for (const word of words) {
    const expanded = ABBREVIATIONS[word] ?? word;
    if (STOPWORDS.has(expanded) || tokens.includes(expanded)) continue;
    tokens.push(expanded);
  }

  return { raw: raw ?? '', text: tokens.join(' '), tokens, streetNumber };
};

/** 0..1 similarity between an address and a candidate team/channel name. */
export const scoreNameMatch = (target: NormalizedName, candidate: NormalizedName): number => {
  // Hard gate: "21 Evergreen" must never match "71 Evergreen". Only applies
  // when BOTH sides carry a number, so a numberless team name stays eligible.
  if (target.streetNumber && candidate.streetNumber && target.streetNumber !== candidate.streetNumber) {
    return 0;
  }

  if (target.tokens.length === 0 || candidate.tokens.length === 0) return 0;

  const candidateSet = new Set(candidate.tokens);
  const shared = target.tokens.filter((t) => candidateSet.has(t)).length;
  if (shared === 0) return 0;

  // Containment, not Jaccard: a short address fully contained in a longer team
  // name is a strong signal, and Jaccard would punish the extra words.
  let score = shared / Math.min(target.tokens.length, candidate.tokens.length);

  if (target.streetNumber && candidate.streetNumber) score += 0.15;
  if (candidate.text.includes(target.text) || target.text.includes(candidate.text)) score += 0.1;

  return Math.min(1, Number(score.toFixed(4)));
};

/** Scores every item, keeps those at or above the threshold, best first. */
export const rankByName = <T>(
  target: NormalizedName,
  items: readonly T[],
  displayNameOf: (item: T) => string,
  limit: number,
): Array<ScoredItem<T>> =>
  items
    .map((item) => ({ item, score: scoreNameMatch(target, normalizeName(displayNameOf(item))) }))
    .filter((entry) => entry.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || displayNameOf(a.item).length - displayNameOf(b.item).length)
    .slice(0, limit);

// A team AND channel that both match beats a single-sided match, but a strong
// one-sided match still surfaces.
export const combineTeamChannelScore = (teamScore: number, channelScore: number): number => {
  const high = Math.max(teamScore, channelScore);
  const low = Math.min(teamScore, channelScore);
  return Number((high * 0.75 + low * 0.25).toFixed(4));
};
