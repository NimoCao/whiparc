import type { Metadata } from 'next';
import ConfirmSubscription from './ConfirmSubscription';

export const metadata: Metadata = {
  title: 'Confirm subscription | Whiparc',
  robots: { index: false, follow: false },
};

export default function ConfirmSubscriptionPage() {
  return <ConfirmSubscription />;
}
