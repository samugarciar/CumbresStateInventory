import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.10", "localhost:3000"],
  serverActions: {
    bodySizeLimit: "5mb",
  },
};

export default nextConfig;
