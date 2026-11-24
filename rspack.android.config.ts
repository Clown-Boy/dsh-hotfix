import { defineConfig } from '@rspack/cli'
import { createConfig } from './rspack.config.js'

const baseConfig = createConfig()

/**
 * Android 端打包配置：在复用上游 rspack.config.ts 的基础上，
 * 启用稳定模块 ID 与第三方依赖拆包，尽量缩小单文件改动时的热更新范围。
 */
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  ...baseConfig,
  optimization: {
    ...baseConfig.optimization,
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    runtimeChunk: 'single',
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        reactVendor: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/,
          name: 'vendor-react',
          chunks: 'all',
          priority: 30,
        },
        markdownVendor: {
          test: /[\\/]node_modules[\\/](katex|prismjs|mdast-.*|micromark-.*|fflate|idb|clsx)[\\/]/,
          name: 'vendor-markdown',
          chunks: 'all',
          priority: 20,
        },
        mermaidVendor: {
          test: /[\\/]node_modules[\\/]mermaid[\\/]/,
          name: 'vendor-mermaid',
          chunks: 'async',
          priority: 25,
        },
      },
    },
  },
})
