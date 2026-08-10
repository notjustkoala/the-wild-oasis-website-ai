/** @type {import('next').NextConfig} */
const supabaseHostname = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).hostname
  : "localhost";

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        port: "",
        pathname: "/storage/v1/object/public/cabin-images/**",
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ["undici"],
  },
};

export default nextConfig;
