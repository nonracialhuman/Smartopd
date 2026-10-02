import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@smartopd/shared"],
  poweredByHeader: false,
  devIndicators: false,
  compress: true,
  productionBrowserSourceMaps: false,
  experimental: { optimizePackageImports: ["lucide-react"] },
  async rewrites() {
    const target = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
