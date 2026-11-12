import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";
import type { IncrementalCache } from "@opennextjs/aws/types/overrides.js";

/**
 * Workers Free plan: 10 ms of CPU per request (2026-11-12, decided with the user: stay on Free).
 *
 * With the default ("dummy") cache, OpenNext rendered even the prerendered pages (/login, /download, /)
 * on every request, so they ran into the limit; a killed render could leave the instance stuck and
 * /login then hung for everyone. Prerendered pages are now read from the build's static assets, and
 * `enableCacheInterception` answers them before the Next.js server is loaded at all.
 *
 * Only page entries come from the assets. The data cache (`unstable_cache` in lib/data.ts) stays
 * uncached exactly as before: the assets are read-only, and the stock override would log an error
 * on every write.
 */
const pagesFromAssets: IncrementalCache = {
  // the stock name: `opennextjs-cloudflare deploy` copies the prerendered pages into the assets
  // (populate-cache) only for a cache with this name
  name: staticAssetsCache.name,
  async get(key, cacheType) {
    if (cacheType === "fetch" || cacheType === "composable") return null;
    return staticAssetsCache.get(key, cacheType);
  },
  async set() {},
  async delete() {},
};

export default defineCloudflareConfig({
  incrementalCache: pagesFromAssets,
  enableCacheInterception: true,
});
