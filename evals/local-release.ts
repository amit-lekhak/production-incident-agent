import { join } from "node:path";
import { LocalReleaseProvider, setReleaseProvider } from "../src/lib/release";
import { readTreeAsMap } from "../src/lib/release/local";
import { activateDeployedSha } from "../src/lib/sim/deployed-runtime";

/** Install a LocalReleaseProvider seeded from services/relay-checkout for offline tests. */
export async function installLocalRelease() {
  const provider = new LocalReleaseProvider();
  const files = readTreeAsMap(join(process.cwd(), "services/relay-checkout"));
  // Only seed source + package.json
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith("graphify-out")) continue;
    filtered[k] = v;
  }
  const sha = provider.seedService(filtered);
  setReleaseProvider(provider);
  await activateDeployedSha(sha);
  return provider;
}

export function uninstallLocalRelease(provider?: LocalReleaseProvider) {
  setReleaseProvider(null);
  provider?.destroy();
}
