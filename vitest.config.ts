import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" -> "./*" path alias.
    // `server-only` is a build-time guard with no runtime behaviour; stub it so
    // server modules (e.g. the data-source factory) can be unit-tested in Node.
    alias: {
      "@": root,
      "server-only": `${root}/lib/test/server-only-stub.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
