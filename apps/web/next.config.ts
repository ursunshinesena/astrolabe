import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agora/types", "@agora/chains", "@agora/circle", "@agora/agent"],
};

export default nextConfig;
