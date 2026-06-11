/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Required for @sparticuz/chromium-min to work on Vercel
  serverExternalPackages: ['@sparticuz/chromium-min'],
};

module.exports = nextConfig;