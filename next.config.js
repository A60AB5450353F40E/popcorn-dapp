/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, options) => {
    config.experiments = {...config.experiments, topLevelAwait: true };
    config.resolve.alias = {...config.resolve.alias, ...{
        bufferutil: false,
        child_process: false,
        crypto: false,
        dns: false,
        events: require.resolve("events/"),
        eventsource: false,
        fs: false,
        http: false,
        https: false,
        libpq: false,
        module: false,
        net: false,
        os: false,
        "parse-database-url": false,
        path: false,
        pg: false,
        "pg-format": false,
        "pg-native": false,
        solc: false,
        tls: false,
        url: false,
        zlib: false,
      }};
    config.resolve.alias = {...config.resolve.alias, ...{
        stream: require.resolve("stream-browserify"),
      }};

    return config
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ipfs.pat.mn',
        port: '',
        pathname: '/ipfs/**',
      },
    ],
  },
}

module.exports = nextConfig
