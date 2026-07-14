import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  // Eski iPhone kurulumları aynı Turbopack dosya adını bir yıl önbellekte
  // tuttuğu için bu sürüm yeni bir asset yolu kullanır.
  assetPrefix: "/assets/20260714-bulkfix",
};

export default nextConfig;
