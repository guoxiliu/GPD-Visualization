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
          src: 'data/!(gpd_4d).bin',
          dest: 'data'
        }
      ],
    })
  ]
})
