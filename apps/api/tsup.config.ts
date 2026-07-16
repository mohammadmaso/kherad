import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  noExternal: [/^@kherad\//],
  external: ["argon2", "isomorphic-git"],
});
