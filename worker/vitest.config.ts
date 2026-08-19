import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * These tests run inside workerd, not Node.
 *
 * That distinction is the reason this config exists. The engine's own suite
 * proves the TypeScript engine matches Python *in Node*; it says nothing about
 * the runtime that actually serves requests. Temporal, Intl and the clock all
 * differ between the two, and a resolver that silently changes underneath us
 * moves every contest by an hour without failing anything.
 *
 * `wrangler.toml` is the single source of the compatibility date -- pointing at
 * it here rather than restating the date keeps the tests and the deploy from
 * drifting apart, which would defeat the purpose of testing in workerd at all.
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
  test: {
    // Runs in Node, before workerd starts: workerd has no child processes, so
    // the Python reference has to be dumped to a fixture from out here.
    globalSetup: ["./tests/global-setup.ts"],
  },
});
