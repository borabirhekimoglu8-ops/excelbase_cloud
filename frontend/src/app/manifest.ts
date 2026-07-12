import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gate Visa Operations",
    short_name: "Gate Visa Ops",
    description: "Passenger Operations Platform",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f9",
    theme_color: "#102a43",
    lang: "tr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
