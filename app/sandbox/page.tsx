import { notFound } from 'next/navigation';
import { SandboxLoader } from './SandboxLoader';

export default function SandboxPage() {
  // A development tool only: it never ships to players.
  if (process.env.NODE_ENV === 'production') notFound();
  return <SandboxLoader />;
}
