import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://motion.trainova.eu.cc",
  trailingSlash: "never",
  build: { format: "file" },
  devToolbar: { enabled: false },
  // The docs page renders the package README from the repo root.
  // The package is linked from the repo root, which has its own three: use one copy.
  // three.js is most of the player chunk (about 190 kB gzipped); the gallery never loads it.
  vite: { server: { fs: { allow: [".."] } }, resolve: { dedupe: ["three"] }, build: { chunkSizeWarningLimit: 800 } },
});
