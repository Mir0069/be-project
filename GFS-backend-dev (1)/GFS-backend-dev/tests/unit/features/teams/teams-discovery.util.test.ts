import {
  MIN_MATCH_SCORE,
  combineTeamChannelScore,
  normalizeName,
  rankByName,
  scoreNameMatch,
} from '@features/teams/teams-discovery.util';

const score = (target: string, candidate: string): number =>
  scoreNameMatch(normalizeName(target), normalizeName(candidate));

describe('normalizeName', () => {
  it('strips our own "GFS - " prefix and " discussion" suffix', () => {
    expect(normalizeName('GFS - 182 Robinson St').tokens).toEqual(['182', 'robinson', 'street']);
    expect(normalizeName('182 Robinson St discussion').tokens).toEqual(['182', 'robinson', 'street']);
  });

  it('expands street abbreviations to a canonical form', () => {
    const cases: Array<[string, string]> = [
      ['1 Main St', 'street'],
      ['1 Main Ave', 'avenue'],
      ['1 Main Rd', 'road'],
      ['1 Main Dr', 'drive'],
      ['1 Main Blvd', 'boulevard'],
      ['1 Main Ln', 'lane'],
      ['1 Main Ct', 'court'],
      ['1 Main Ter', 'terrace'],
      ['1 Main Pl', 'place'],
      ['1 Main Pkwy', 'parkway'],
      ['1 Main Hwy', 'highway'],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeName(input).tokens).toContain(expected);
    }
  });

  it('expands directionals', () => {
    expect(normalizeName('12 N Main St').tokens).toContain('north');
    expect(normalizeName('12 SW Main St').tokens).toContain('southwest');
  });

  it('drops punctuation, collapses whitespace and removes stopwords', () => {
    const normalized = normalizeName('  10208   Van-Thompson  Rd., Unit B  ');
    expect(normalized.tokens).toEqual(['10208', 'van', 'thompson', 'road', 'b']);
    expect(normalized.text).toBe('10208 van thompson road b');
  });

  it('extracts the leading street number, including a letter suffix', () => {
    expect(normalizeName('10208 Van Thompson Rd').streetNumber).toBe('10208');
    expect(normalizeName('12a Evergreen Terrace').streetNumber).toBe('12a');
  });

  it('returns a null street number when the address has no number', () => {
    expect(normalizeName('Evergreen Terrace').streetNumber).toBeNull();
  });

  it('handles empty and whitespace-only input without throwing', () => {
    expect(normalizeName('').tokens).toEqual([]);
    expect(normalizeName('   ').streetNumber).toBeNull();
  });
});

describe('scoreNameMatch', () => {
  it('hard-gates a different street number to zero', () => {
    expect(score('21 Evergreen Terrace', '71 Evergreen Ter')).toBe(0);
    expect(score('21 Evergreen Terrace', 'GFS - 71 Evergreen Terrace')).toBe(0);
  });

  it('scores the same street number highly across abbreviations', () => {
    expect(score('21 Evergreen Terrace', 'GFS - 21 Evergreen Ter')).toBeGreaterThan(0.9);
    expect(score('10208 Van Thompson Rd', '10208 Van Thompson Road discussion')).toBeGreaterThan(0.9);
  });

  it('does not gate when only one side has a street number', () => {
    expect(score('Evergreen Terrace', '21 Evergreen Ter')).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it('rewards a short address contained in a longer team name', () => {
    expect(score('182 Robinson St', '182 Robinson Street Rebuild')).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it('scores zero when no tokens are shared', () => {
    expect(score('182 Robinson St', 'Marketing')).toBe(0);
  });

  it('scores zero when either side is empty', () => {
    expect(score('', '182 Robinson St')).toBe(0);
    expect(score('182 Robinson St', '   ')).toBe(0);
  });

  it('never exceeds 1', () => {
    expect(score('21 Evergreen Terrace', '21 Evergreen Terrace')).toBeLessThanOrEqual(1);
  });
});

describe('rankByName', () => {
  const items = [
    { id: 'a', name: 'GFS - 21 Evergreen Terrace' },
    { id: 'b', name: '21 Evergreen Ter' },
    { id: 'c', name: '71 Evergreen Terrace' },
    { id: 'd', name: 'Marketing' },
  ];
  const rank = (limit: number) =>
    rankByName(normalizeName('21 Evergreen Terrace'), items, (i) => i.name, limit);

  it('drops candidates below the threshold', () => {
    const ids = rank(10).map((r) => r.item.id);
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('d');
  });

  it('sorts by score descending', () => {
    const scores = rank(10).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });

  it('breaks ties toward the shorter display name', () => {
    const tied = [
      { id: 'long', name: '21 Evergreen Terrace Project Site' },
      { id: 'short', name: '21 Evergreen Terrace' },
    ];
    const ranked = rankByName(normalizeName('21 Evergreen Terrace'), tied, (i) => i.name, 10);
    expect(ranked[0]!.item.id).toBe('short');
  });

  it('respects the limit', () => {
    expect(rank(1)).toHaveLength(1);
  });
});

describe('combineTeamChannelScore', () => {
  it('ranks a both-sided match above a one-sided match', () => {
    expect(combineTeamChannelScore(0.9, 0.9)).toBeGreaterThan(combineTeamChannelScore(0.9, 0));
  });

  it('keeps a strong one-sided match above the threshold', () => {
    expect(combineTeamChannelScore(1, 0)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it('is order independent', () => {
    expect(combineTeamChannelScore(0.4, 0.8)).toBe(combineTeamChannelScore(0.8, 0.4));
  });
});
