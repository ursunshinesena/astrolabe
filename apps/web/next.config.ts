import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@astrolabe/types",
    "@astrolabe/chains",
    "@astrolabe/circle",
    "@astrolabe/agent",
  ],
};

export default nextConfig;
