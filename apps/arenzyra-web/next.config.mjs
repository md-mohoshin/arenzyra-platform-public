// Keep dev media working when the API is on localhost:3000 while the web app
// runs on a different port (e.g., 3001). When unoptimized is true, Next.js
// skips the image proxy and the browser requests the asset directly from the
// API host instead of tunneling through the Next.js dev server.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const api = new URL(apiUrl);
const apiPort = api.port || (api.protocol === "https:" ? "443" : "80");
const devUnoptimized = process.env.NODE_ENV !== "production" && api.hostname === "localhost";
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";

const allowHosts = Array.from(new Set(["localhost", "127.0.0.1", api.hostname].filter(Boolean)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: isVercel ? ".next" : ".next-build",
  images: {
    unoptimized: devUnoptimized,
    remotePatterns: allowHosts.map((hostname) => ({
      protocol: api.protocol.replace(":", ""),
      hostname,
      port: apiPort,
    })),
  },
};

export default nextConfig;
