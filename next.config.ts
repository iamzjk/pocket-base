import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ] }];
  },
};
export default config;
