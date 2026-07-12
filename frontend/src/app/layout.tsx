import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gate Visa Operations",
  description: "Yolcu listeleri, evrak kontrolleri ve teslim dosyaları için operasyon platformu.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Gate Visa Ops",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    // iOS Safari yalnızca PNG apple-touch-icon kabul eder.
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#102a43",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
