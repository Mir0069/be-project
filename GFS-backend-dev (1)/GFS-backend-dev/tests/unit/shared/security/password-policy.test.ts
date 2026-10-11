import { getPasswordPolicyErrors } from '@shared/security/password-policy';

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(getPasswordPolicyErrors('GfsSecure!2026')).toEqual([]);
  });

  it('requires length and character variety', () => {
    const errors = getPasswordPolicyErrors('short');

    expect(errors).toEqual(expect.arrayContaining([
      'Password must be at least 8 characters long.',
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    ]));
  });

  it('requires all four character types', () => {
    expect(getPasswordPolicyErrors('Abcdefg1')).toContain(
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    );
    expect(getPasswordPolicyErrors('Abcdef1!')).toEqual([]);
  });

  it('rejects common and personal passwords', () => {
    expect(getPasswordPolicyErrors('Password@123')).toEqual(expect.arrayContaining([
      'Password is too common. Choose a less predictable password.',
    ]));
    expect(getPasswordPolicyErrors('AliceSecure!2026', {
      email: 'alice@example.com',
      firstName: 'Alice',
    })).toEqual(expect.arrayContaining([
      'Password must not contain your name or email address.',
    ]));
  });

  it('rejects meaningful fragments of a user name', () => {
    expect(getPasswordPolicyErrors('JemuSecure!2026', {
      email: 'jsheta150@gmail.com',
      firstName: 'Jemunesh',
    })).toContain('Password must not contain your name or email address.');
  });

  it('enforces bcrypt byte limits for Unicode passwords', () => {
    const errors = getPasswordPolicyErrors(`Aa1!${'x'.repeat(67)}é`);

    expect(errors).toEqual(expect.arrayContaining([
      'Password must not exceed 72 UTF-8 bytes.',
    ]));
  });
});
