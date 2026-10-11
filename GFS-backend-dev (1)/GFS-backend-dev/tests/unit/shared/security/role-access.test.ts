import { UserRole } from '@db/models/user.model';
import { canManageRole, effectiveRoles, hasAnyRole } from '@shared/security/role-access';

describe('role access helpers', () => {
  describe('effectiveRoles', () => {
    it('expands Head of Division into every client-facing role', () => {
      expect(effectiveRoles(UserRole.HEAD_OF_DIVISION)).toEqual([
        UserRole.HEAD_OF_DIVISION,
        UserRole.SYSTEM_ADMIN,
        UserRole.SALES_MANAGER,
        UserRole.ESTIMATOR,
      ]);
    });

    it.each([UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN])(
      'keeps %s as a single role',
      (role) => {
        expect(effectiveRoles(role)).toEqual([role]);
      },
    );

    it('returns nothing for a missing role', () => {
      expect(effectiveRoles(undefined)).toEqual([]);
      expect(effectiveRoles(null)).toEqual([]);
      expect(effectiveRoles('')).toEqual([]);
    });
  });

  describe('hasAnyRole', () => {
    it.each([UserRole.SYSTEM_ADMIN, UserRole.SALES_MANAGER, UserRole.ESTIMATOR])(
      'lets Head of Division satisfy a %s check',
      (role) => {
        expect(hasAnyRole(UserRole.HEAD_OF_DIVISION, [role])).toBe(true);
      },
    );

    it('does not give Head of Division Super Admin rights', () => {
      expect(hasAnyRole(UserRole.HEAD_OF_DIVISION, [UserRole.SUPER_ADMIN])).toBe(false);
    });

    it('keeps existing roles unchanged', () => {
      expect(hasAnyRole(UserRole.SYSTEM_ADMIN, [UserRole.SYSTEM_ADMIN])).toBe(true);
      expect(hasAnyRole(UserRole.ESTIMATOR, [UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN])).toBe(false);
      expect(hasAnyRole(UserRole.SUPER_ADMIN, [UserRole.SYSTEM_ADMIN])).toBe(false);
    });

    it('does not let other roles satisfy a Head of Division check', () => {
      expect(hasAnyRole(UserRole.SYSTEM_ADMIN, [UserRole.HEAD_OF_DIVISION])).toBe(false);
      expect(hasAnyRole(UserRole.SUPER_ADMIN, [UserRole.HEAD_OF_DIVISION])).toBe(false);
    });

    it('accepts plain role strings and rejects a missing role', () => {
      expect(hasAnyRole('HEAD_OF_DIVISION', ['SALES_MANAGER'])).toBe(true);
      expect(hasAnyRole(undefined, ['SALES_MANAGER'])).toBe(false);
    });
  });

  describe('canManageRole', () => {
    it('only lets a Super Admin manage Head of Division', () => {
      expect(canManageRole(UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION)).toBe(true);
      expect(canManageRole(UserRole.SYSTEM_ADMIN, UserRole.HEAD_OF_DIVISION)).toBe(false);
      expect(canManageRole(UserRole.HEAD_OF_DIVISION, UserRole.HEAD_OF_DIVISION)).toBe(false);
      expect(canManageRole(undefined, UserRole.HEAD_OF_DIVISION)).toBe(false);
    });

    it('leaves every other role to the existing checks', () => {
      expect(canManageRole(UserRole.SYSTEM_ADMIN, UserRole.ESTIMATOR)).toBe(true);
      expect(canManageRole(UserRole.HEAD_OF_DIVISION, UserRole.SALES_MANAGER)).toBe(true);
      expect(canManageRole(undefined, UserRole.ESTIMATOR)).toBe(true);
    });
  });
});
