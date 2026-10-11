import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'


const hideViteClientLogs = (): Plugin => ({
  name: 'hide-vite-client-logs',
  apply: 'serve',
  transformIndexHtml: {
    order: 'pre',
    handler: () => [
      {
        tag: 'script',
        injectTo: 'head-prepend',
        children: `(function () {
  var isViteMessage = function (args) {
    return typeof args[0] === 'string' && args[0].indexOf('[vite]') === 0;
  };
  ['log', 'debug'].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      if (isViteMessage(arguments)) return;
      original.apply(null, arguments);
    };
  });
})();`,
      },
    ],
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), hideViteClientLogs()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@assets': path.resolve(__dirname, './assets'),
      },
    },
        build: {
      target: 'esnext',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
                return 'vendor-react';
              }
              if (id.includes('lucide-react') || id.includes('clsx') || id.includes('tailwind-merge')) {
                return 'vendor-ui';
              }
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
          headers: {
            'ngrok-skip-browser-warning': 'true',
          },
        },
      },
    },
  }
})
