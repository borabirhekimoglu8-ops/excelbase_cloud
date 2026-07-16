import type { Metadata, Viewport } from "next";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Excelbase",
  title: "Excelbase · Yolcu Operasyonları",
  description: "Yolcu listeleri, fotoğraflar ve teslim dosyaları için çevrimdışı operasyon uygulaması.",
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: "Excelbase",
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
  themeColor: "#007ea7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
