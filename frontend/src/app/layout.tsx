import type { Metadata, Viewport } from "next";
import { Outfit, Syne } from "next/font/google";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AegeanBackdrop } from "@/components/ui/AegeanBackdrop";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-outfit",
});

const syne = Syne({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-syne",
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
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1f33",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${outfit.variable} ${syne.variable}`}>
      <body className={outfit.className}>
        <AegeanBackdrop />
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
