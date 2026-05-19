/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['xlsx'],
    outputFileTracingIncludes: {
      '/api/chat': ['./standards/customer-file-review/**/*'],
    },
  },
};

export default nextConfig;
