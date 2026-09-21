import type { MetadataRoute } from "next";
import { PRODUCT } from "@/lib/product";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PRODUCT.fullName,
    short_name: PRODUCT.shortName,
    description: PRODUCT.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: PRODUCT.backgroundColor,
    theme_color: PRODUCT.themeColor,
    lang: "tr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
