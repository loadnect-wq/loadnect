import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // SECURITY: this was hostname "**", which matches EVERY host. Next's image
    // optimizer will fetch and re-serve any URL it is given, so a wildcard
    // turns /_next/image into an open proxy on our own domain: an attacker
    // could serve arbitrary remote content from hallnect.com (brand-laundered
    // phishing) and burn our bandwidth and image cache doing it.
    //
    // Every remote <Image> src in this app comes from Supabase Storage via
    // getPublicUrl (lib/supabase/storage.ts); local assets like /logo.png are
    // covered separately by the default local patterns. So the allow-list is
    // exactly the Supabase storage host, scoped to its public object path.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
