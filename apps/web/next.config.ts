import type { NextConfig } from 'next';

/**
 * Two build targets:
 * - default: the local workstation, proxying /api → agent-api (:8000) and /owner-api → owner-api (:8002).
 * - AEGIS_STATIC=1: a static export (out/) for public hosting. It reads recorded evidence from
 *   /evidence and live vault state from public NEAR testnet RPC. It holds no keys and cannot sign.
 */
const STATIC = process.env.AEGIS_STATIC === '1';
const basePath = process.env.AEGIS_BASE_PATH || '';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@aegis/receipt-verifier'],
  env: { NEXT_PUBLIC_STATIC: STATIC ? '1' : '0', NEXT_PUBLIC_BASE_PATH: basePath },
  ...(STATIC
    ? { output: 'export' as const, basePath: basePath || undefined, images: { unoptimized: true }, trailingSlash: true }
    : {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: `${process.env.AEGIS_AGENT_API ?? 'http://127.0.0.1:8000'}/:path*` },
            { source: '/owner-api/:path*', destination: `${process.env.AEGIS_OWNER_API ?? 'http://127.0.0.1:8002'}/:path*` },
          ];
        },
        async headers() {
          return [{ source: '/:path*', headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
          ] }];
        },
      }),
};
export default config;
