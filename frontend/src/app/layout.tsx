import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  applicationName: "Excelbase Operations",
    title: "Excelbase Operations · Operasyon ve evrak merkezi",
    description: "İş dosyaları, yolcular, evraklar, raporlar ve kapı vizesi süreçleri için çevrimdışı operasyon merkezi.",
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: "Excelbase Operations",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
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
    <html lang="tr" className={inter.variable}>
      <body className={inter.className}>
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
