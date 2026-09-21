import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Source_Sans_3 } from "next/font/google";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AegeanBackdrop } from "@/components/ui/AegeanBackdrop";
import { PRODUCT, productWindowTitle } from "@/lib/product";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-source-sans",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-bricolage",
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
    <html lang="tr" className={`${sourceSans.variable} ${bricolage.variable}`}>
      <body className={sourceSans.className}>
        <AegeanBackdrop />
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
