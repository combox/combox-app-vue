const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')

const root = __dirname

module.exports = (env, argv) => {
  const mode = argv.mode || 'development'
  const isDev = mode === 'development'

  const apiBase =
    process.env.VUE_API_BASE_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.PUBLIC_API_BASE_URL ||
    'https://api.combox.local/api/private/v1'
  const wsBase =
    process.env.VUE_WS_BASE_URL ||
    process.env.VITE_WS_BASE_URL ||
    process.env.PUBLIC_WS_BASE_URL ||
    'wss://api.combox.local/api/private/v1/ws'

  return {
    mode,
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
    },
    entry: path.resolve(root, 'src/main.ts'),
    output: {
      path: path.resolve(root, 'dist'),
      filename: isDev ? 'assets/[name].js' : 'assets/[name].[contenthash:8].js',
      chunkFilename: isDev ? 'assets/[name].chunk.js' : 'assets/[name].[contenthash:8].chunk.js',
      clean: true,
      publicPath: '/',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],
      alias: {
        '@': path.resolve(root, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.vue$/,
          loader: 'vue-loader',
        },
        {
          test: /\.tsx?$/,
          loader: 'esbuild-loader',
          options: {
            loader: 'ts',
            target: 'es2020',
          },
          exclude: /node_modules/,
        },
        {
          test: /\.m?js$/,
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.css$/,
          use: [
            'style-loader',
            {
              loader: 'css-loader',
              options: {
                url: {
                  filter: (url) => !url.startsWith('/assets/fonts/'),
                },
              },
            },
          ],
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp|woff2?|eot|ttf|otf)$/i,
          type: 'asset',
          generator: {
            filename: 'assets/[name][ext]'
          }
        },
      ],
    },
    plugins: [
      new VueLoaderPlugin(),
      new HtmlWebpackPlugin({
        template: path.resolve(root, 'index.html'),
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(root, 'public'),
            to: path.resolve(root, 'dist'),
            noErrorOnMissing: true,
          },
        ],
      }),
      new webpack.DefinePlugin({
        'import.meta.env': JSON.stringify({
          VUE_API_BASE_URL: apiBase,
          VUE_WS_BASE_URL: wsBase,
          VITE_API_BASE_URL: apiBase,
          VITE_WS_BASE_URL: wsBase,
        }),
        'import.meta.env.VUE_API_BASE_URL': JSON.stringify(apiBase),
        'import.meta.env.VUE_WS_BASE_URL': JSON.stringify(wsBase),
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
        'import.meta.env.VITE_WS_BASE_URL': JSON.stringify(wsBase),
        __VUE_OPTIONS_API__: JSON.stringify(true),
        __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
      }),
    ],
    devtool: isDev ? 'eval-cheap-module-source-map' : false,
    devServer: {
      host: '0.0.0.0',
      port: 4173,
      historyApiFallback: true,
      hot: true,
      allowedHosts: 'all',
      static: {
        directory: path.resolve(root, 'public'),
      },
    },
    experiments: isDev
      ? {
          cacheUnaffected: true,
          lazyCompilation: {
            entries: false,
            imports: true,
          },
        }
      : {},
    optimization: {
      splitChunks: {
        chunks: 'all',
      },
      runtimeChunk: 'single',
    },
    performance: {
      hints: false,
    },
    stats: 'minimal',
  }
}
