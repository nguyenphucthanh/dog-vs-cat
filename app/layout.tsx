import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ConvexClientProvider } from '@/components/ConvexClientProvider';
import { AudioUnlock } from '@/game/sound';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'vietnamese'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'vietnamese'],
});

export const metadata: Metadata = {
  title: 'Chó vs Mèo',
  description: 'Game bắn pháo 3D theo lượt, hai đội Chó và Mèo',
  icons: {
    icon: '/convex.svg',
  },
};

// Pinching to zoom would fight with the on-screen controls.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AudioUnlock />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
