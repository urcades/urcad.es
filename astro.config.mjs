import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import satteriHighlight from "./plugins/satteri-highlight.mjs";
import satteriResponsiveImages from "./plugins/satteri-responsive-images.mjs";

export default defineConfig({
  image: {
    domains: ["d2w9rnfcy7mm78.cloudfront.net"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.urcad.es",
        pathname: "/assets/**",
      },
    ],
  },
  markdown: {
    syntaxHighlight: false,
    processor: satteri({
      hastPlugins: [satteriResponsiveImages(), satteriHighlight()],
    }),
  },
  site: "https://www.urcad.es",
  prefetch: {
    prefetchAll: false,
  },
  integrations: [sitemap()],
});
