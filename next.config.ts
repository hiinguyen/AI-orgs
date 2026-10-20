import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Next dev otherwise appends its agent rules to AGENTS.md, which this repo
  // owns and expects to stay unchanged.
  agentRules: false,
};

export default nextConfig;
