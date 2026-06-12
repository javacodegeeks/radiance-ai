/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Prevent Next.js from bundling Node.js-only packages used by the AI layer.
    serverComponentsExternalPackages: [
      'radiance-ai-core',
      '@langchain/langgraph',
      '@langchain/core',
      '@langchain/community',
      '@langchain/tavily',
      'openai',
      'zod',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Tell webpack to skip resolution entirely for these packages —
      // they are resolved at runtime by Node.js from node_modules.
      const AI_EXTERNALS = [
        'radiance-ai-core',
        '@langchain/langgraph',
        '@langchain/core',
        '@langchain/community',
        '@langchain/tavily',
        'openai',
        'zod',
      ];
      const existing = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...existing,
        ({ request }, callback) => {
          if (AI_EXTERNALS.some(pkg => request === pkg || request.startsWith(pkg + '/'))) {
            return callback(null, 'commonjs ' + request);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
