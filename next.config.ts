import type { NextConfig } from 'next';
import {
  assertSchemaMatchesEnvironment,
  resolveDbSchema,
} from './src/lib/db-schema';

// Database schema of this build: public (Production) or public_preview
// (Preview). Invalid values and a Vercel production/preview build with the
// wrong schema abort the build. Without any variable the schema is public.
const dbSchema = resolveDbSchema({
  NEXT_PUBLIC_DB_SCHEMA: process.env.NEXT_PUBLIC_DB_SCHEMA,
  SUPABASE_DB_SCHEMA: process.env.SUPABASE_DB_SCHEMA,
});
assertSchemaMatchesEnvironment(dbSchema, process.env.VERCEL_ENV);

const nextConfig: NextConfig = {
  // NEXT_PUBLIC_* is inlined at build time, so each deployment needs its own build.
  env: {
    NEXT_PUBLIC_DB_SCHEMA: dbSchema,
  },
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
