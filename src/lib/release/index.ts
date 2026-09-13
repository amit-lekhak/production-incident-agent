import { getEnv } from "@/lib/env";
import { GitHubReleaseProvider } from "./github";
import { LocalReleaseProvider } from "./local";
import type { ReleaseProvider } from "./types";

export type {
  ReleaseProvider,
  DeployRecord,
  CommitRecord,
  PrRecord,
} from "./types";
export { GitHubReleaseProvider } from "./github";
export { LocalReleaseProvider } from "./local";

let cached: ReleaseProvider | null = null;
let localOverride: ReleaseProvider | null = null;

/** Tests/evals inject a LocalReleaseProvider so they never hit GitHub. */
export function setReleaseProvider(provider: ReleaseProvider | null) {
  localOverride = provider;
  cached = null;
}

export function getReleaseProvider(): ReleaseProvider {
  if (localOverride) return localOverride;
  if (cached) return cached;
  // RELEASE_PROVIDER=local is only for offline smoke when explicitly set.
  if (process.env.RELEASE_PROVIDER === "local") {
    cached = new LocalReleaseProvider();
    return cached;
  }
  // Touch env so missing GITHUB_* fail at first use.
  getEnv();
  cached = new GitHubReleaseProvider();
  return cached;
}
