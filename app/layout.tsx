import type { Metadata } from 'next';
import { Titillium_Web } from 'next/font/google';
import './globals.css';

const titillium = Titillium_Web({ 
  subsets: ['latin'],
  weight: ['300', '400', '600', '700'],
  variable: '--font-titillium',
});

export const metadata: Metadata = {
  title: 'RE Analyzer',
  description: 'Commercial Real Estate Intelligence',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={titillium.variable}>
      <body className={titillium.className}>{children}</body>
    </html>
  );
}