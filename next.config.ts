import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Chaos / checkout load services/* via fs. Include them in serverless traces.
  outputFileTracingIncludes: {
    "/*": [
      "./services/patches/**/*",
      "./services/relay-checkout/src/**/*",
      "./services/relay-checkout/package.json",
    ],
  },
};

export default nextConfig;
