import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Pin the workspace root: without it Turbopack walks up to the user's home
  // directory, finds an unrelated package-lock.json and prints a warning.
  turbopack: {
    root: import.meta.dirname,
  },
  // Next dev otherwise appends its agent rules to AGENTS.md, which this repo
  // owns and expects to stay unchanged.
  agentRules: false,
};

export default nextConfig;
