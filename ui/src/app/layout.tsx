import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:       'Radiance AI',
  description: 'Personalised cosmetic product recommendations powered by AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-rose-50">{children}</body>
    </html>
  );
}
