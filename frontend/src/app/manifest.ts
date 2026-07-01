import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gate Visa PAX",
    short_name: "Gate Visa",
    description: "Gate Visa PAX operasyon merkezi",
    start_url: "/",
    display: "standalone",
    background_color: "#050b14",
    theme_color: "#071526",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
