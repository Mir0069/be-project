import { canViewAllNotifications } from '@db/models/notification.model';
import { UserRole } from '@db/models/user.model';
import { buildInviteEmail } from '@shared/mailer/templates/invite.template';

describe('notification audience', () => {
  it.each([UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION])(
    'lets %s see every notification',
    (role) => {
      expect(canViewAllNotifications(role)).toBe(true);
    },
  );

  it('keeps estimators on their own targeted notifications', () => {
    expect(canViewAllNotifications(UserRole.ESTIMATOR)).toBe(false);
  });
});

describe('invite email role label', () => {
  it('names the Head of Division role in the subject', () => {
    const mail = buildInviteEmail({ firstName: 'Asha', role: UserRole.HEAD_OF_DIVISION, link: 'https://gfs.test/set' });

    expect(mail.subject).toBe('Set up your Head of Division account on GFS');
  });
});
