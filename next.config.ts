import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    const imageCacheHeaders=[
      {
        key:"Cache-Control",
        value:"public, max-age=604800, stale-while-revalidate=2592000"
      }
    ];

    const imageSources=[
      "/hero-backgrounds/:path*",
      "/season-heroes/:path*",
      "/season-backgrounds/:path*",
      "/theme-backgrounds/:path*",
      "/season-rain/:path*",
      "/images/maps/:path*",
      "/images/cases/:path*",
      "/images/case-items/:path*",
      "/images/games/:path*",
      "/images/flags/:path*",
      "/branding/:path*",
      "/avatars/:path*",
      "/case-items/:path*",
      "/payment-methods/:path*"
    ];

    return [
      ...imageSources.map(source=>({
        source,
        headers:imageCacheHeaders
      })),
      {
        source:"/(.*)",
        headers:securityHeaders
      }
    ];
  },
};

export default nextConfig;
