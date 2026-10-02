// Minimal root layout (required by Next.js). This app has no UI.
import type { ReactNode } from 'react';
export const metadata = { title: 'Community Intel API' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
