import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, isPreview, mode }) => {
  const platform = loadEnv(mode, process.cwd(), 'VITE_PLATFORM').VITE_PLATFORM
  const portalBuild = platform === 'crazygames' || platform === 'poki'
  // GitHub Pages serves the game from /postcard-trail/, portals load it from their own relative path.
  return { base: (command === 'build' || isPreview) && !portalBuild ? '/postcard-trail/' : './' }
})
