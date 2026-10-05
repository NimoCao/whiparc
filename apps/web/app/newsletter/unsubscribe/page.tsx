import type { Metadata } from 'next';
import Unsubscribe from './Unsubscribe';

export const metadata: Metadata = {
  title: 'Unsubscribe | Whiparc',
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return <Unsubscribe />;
}
