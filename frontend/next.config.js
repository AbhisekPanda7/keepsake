/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Lets a phone on the same home network open the development server. Has no effect on a deployed site.
  allowedDevOrigins: ['192.168.*.*'],
};

export default nextConfig;
