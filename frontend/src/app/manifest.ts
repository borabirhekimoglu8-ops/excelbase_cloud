import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Excelbase Operations",
    short_name: "Excelbase Operations",
    description: "İş dosyaları, yolcular, evraklar, raporlar ve Gate Visa süreçleri için çevrimdışı operasyon merkezi.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f7f9",
    theme_color: "#007ea7",
    lang: "tr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
