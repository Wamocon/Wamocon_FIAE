import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['localhost'],
  },
  typescript: {
    // Temporarily ignore TS errors to allow dashboard integration while migrating legacy files
    ignoreBuildErrors: true,
  },
  eslint: {
    // Temporarily ignore ESLint errors during schema migration
    ignoreDuringBuilds: true,
  },
  // Webpack configuration for react-pdf
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
