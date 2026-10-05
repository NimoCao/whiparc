import type { Metadata } from 'next';
import ContactForm from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact | Whiparc',
  description: 'Questions, feedback or partnership ideas? Send the Whiparc team a message.',
};

export default function ContactPage() {
  return <ContactForm />;
}
