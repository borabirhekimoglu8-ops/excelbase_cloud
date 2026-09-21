import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces } from "next/font/google";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AegeanBackdrop } from "@/components/ui/AegeanBackdrop";
import { PRODUCT, productWindowTitle } from "@/lib/product";
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
  applicationName: PRODUCT.fullName,
  title: productWindowTitle(),
  description: PRODUCT.description,
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: PRODUCT.fullName,
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
  themeColor: PRODUCT.themeColor,
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
