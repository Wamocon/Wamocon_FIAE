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
assertSchemaMatchesEnvironment(
  dbSchema,
  process.env.VERCEL_ENV,
  process.env.DB_CONNECTION_STRING
);

// Files that a function needs and the file tracing cannot see (see below).
const PDF_READER_FILES = [
  './node_modules/pdf-parse/package.json',
  './node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js',
  './node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js',
  './node_modules/node-ensure/package.json',
  './node_modules/node-ensure/index.js',
];

const nextConfig: NextConfig = {
  // NEXT_PUBLIC_* is inlined at build time, so each deployment needs its own build.
  env: {
    NEXT_PUBLIC_DB_SCHEMA: dbSchema,
  },
  images: {
    domains: ['localhost'],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // The PDF reader of the content upload loads the pdf.js build of pdf-parse
  // by a path that is built at run time (src/lib/content-upload/pdf-worker.ts),
  // so the file tracing cannot see it and a Vercel function would not contain
  // it (the reader would answer ENGINE_UNAVAILABLE for every PDF). The routes
  // that read a PDF name the files here: pump (extract step) and dry-run and
  // apply (check of the originals). The keys are globs: [runId] would be a
  // character class there, so the segment is matched with *.
  outputFileTracingIncludes: {
    '/api/trainer/content-upload/runs/*/pump': PDF_READER_FILES,
    '/api/trainer/content-upload/runs/*/dry-run': PDF_READER_FILES,
    '/api/trainer/content-upload/runs/*/apply': PDF_READER_FILES,
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
  // The list of all modules ("Meine Fragenkomplexe") is gone, "Lernen" shows
  // the same courses. An old link or bookmark goes there. The page of one
  // course (/trainee/modules/<id>) is not touched, the source is exact.
  async redirects() {
    return [
      {
        source: '/trainee/modules',
        destination: '/trainee/courses',
        permanent: false,
      },
    ];
  },
  // Webpack configuration for react-pdf
  webpack: config => {
    config.resolve.alias.canvas = false;
    config.cache = false;
    return config;
  },
};

export default nextConfig;
