import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: '/GPD-Visualization/',
  build: {
    target: 'esnext',
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'data/!(gpd*).npy',
          dest: 'data'
        },
        {
          src: 'data/!(gpd*).bin',
          dest: 'data'
        }
      ],
    })
  ]
})
