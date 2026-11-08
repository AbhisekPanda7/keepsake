import ForgotPassword from '@/components/Account/ForgotPassword';
import AccountOnly from '@/components/Account/AccountOnly';

export const metadata = { title: 'Forgotten password · Keepsake' };

export default function ForgotPasswordPage() {
  return (
    <AccountOnly>
      <ForgotPassword />
    </AccountOnly>
  );
}
