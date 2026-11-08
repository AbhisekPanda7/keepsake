import ResetPassword from '@/components/Account/ResetPassword';
import AccountOnly from '@/components/Account/AccountOnly';

export const metadata = { title: 'Choose a new password · Keepsake', referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return (
    <AccountOnly>
      <ResetPassword />
    </AccountOnly>
  );
}
