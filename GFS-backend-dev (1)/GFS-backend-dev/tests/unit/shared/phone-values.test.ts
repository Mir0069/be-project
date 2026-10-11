import { normalizePhoneValue, splitPhoneValues } from '@shared/utils/phone-values';

describe('phone value normalization', () => {
  it('keeps multiple numbers from arrays and delimited text', () => {
    expect(splitPhoneValues([
      '(801) 483-1660; (801) 635-6312',
      '(801) 887-7226',
    ])).toEqual([
      '(801) 483-1660',
      '(801) 635-6312',
      '(801) 887-7226',
    ]);
  });

  it('returns a canonical newline-separated value and removes duplicates', () => {
    expect(normalizePhoneValue('(801) 483-1660, (801) 483-1660 / (801) 635-6312'))
      .toBe('(801) 483-1660\n(801) 635-6312');
  });

  it('returns null for a missing value', () => {
    expect(normalizePhoneValue(null)).toBeNull();
    expect(normalizePhoneValue([])).toBeNull();
  });
});
