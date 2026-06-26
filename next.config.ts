import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['localhost', 'thzssnabxgchzbsnbgoh.supabase.co'],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Tree-shake specific heavy packages — only bundles the imports actually used
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      'date-fns',
      'react-hot-toast',
      '@supabase/supabase-js',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
    ],
  },
  // Webpack configuration for react-pdf
  webpack: config => {
    config.resolve.alias.canvas = false;
    config.cache = false;
    return config;
  },
};

export default nextConfig;
