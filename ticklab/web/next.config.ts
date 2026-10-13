import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electrobun serves the built app as static files (offline desktop app).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
