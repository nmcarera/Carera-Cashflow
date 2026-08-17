import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js sizes its build worker pool from `os.cpus().length`, which
    // reports the *host* machine's core count, not what's actually
    // reserved for the container running the build. On a shared/"bare
    // metal" build host with many cores but a small per-build memory
    // slice (e.g. Railway), that default over-commits badly — the build
    // spawns as many workers as host cores, each one loading Turbopack
    // and native addons, and blows past the container's real memory
    // budget. That over-commit is the most likely cause of the native
    // crash (SIGSEGV, no JS error) seen partway through `next build` on
    // Railway. Capping it low trades a few seconds of build time for a
    // build that doesn't crash.
    cpus: 2,
  },
};

export default nextConfig;
