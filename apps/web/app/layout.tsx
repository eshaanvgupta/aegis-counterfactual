import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AEGIS // Counterfactual',
  description: 'The AI can be compromised. The financial authorization boundary cannot. Counterfactual replay, a security swarm, and a NEAR vault that enforces the owner’s mandate.',
};

export const viewport: Viewport = { themeColor: '#06080b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
