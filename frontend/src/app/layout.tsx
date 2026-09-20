import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces } from "next/font/google";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AegeanBackdrop } from "@/components/ui/AegeanBackdrop";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-figtree",
});

const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-fraunces",
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
  themeColor: "#0c2233",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${figtree.variable} ${fraunces.variable}`}>
      <body className={figtree.className}>
        <AegeanBackdrop />
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
