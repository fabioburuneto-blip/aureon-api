import type { Metadata, Viewport } from 'next';
import { exigirSuperadmin } from '@/lib/sessao';

export const metadata: Metadata = { title: { template: '%s · Admin', default: 'Admin' }, robots: { index: false } };
export const viewport: Viewport = { themeColor: '#0b0d10' };

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  await exigirSuperadmin();
  return children;
}
