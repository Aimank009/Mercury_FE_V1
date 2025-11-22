/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Externalize packages that should not be bundled
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    
    // Fix for MetaMask SDK and other browser-only packages
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        path: false,
        os: false,
        // Fix for React Native dependencies
        '@react-native-async-storage/async-storage': false,
        'react-native': false,
      };
    }
    
    // Ignore node-specific modules in browser bundle
    config.resolve.alias = {
      ...config.resolve.alias,
      'node:crypto': false,
      'node:stream': false,
      'node:buffer': false,
      // Polyfill React Native async-storage with empty module
      '@react-native-async-storage/async-storage': false,
    };
    
    // Handle ES modules
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    
    // Add rule to handle .mjs files
    config.module.rules.push({
      test: /\.m?js$/,
      type: 'javascript/auto',
      resolve: {
        fullySpecified: false,
      },
    });
    
    return config;
  },
  // Transpile packages that need to be processed by webpack
  transpilePackages: [
    '@rainbow-me/rainbowkit',
    '@wagmi/connectors',
    '@wagmi/core',
    'wagmi',
    '@walletconnect/ethereum-provider',
    '@reown/appkit',
  ],
  // Ignore TypeScript errors during build (optional - remove if you want strict checks)
  typescript: {
    ignoreBuildErrors: false,
  },
  // Ignore ESLint errors during build (optional - remove if you want strict checks)
  eslint: {
    ignoreDuringBuilds: false,
  },
};

module.exports = nextConfig;
