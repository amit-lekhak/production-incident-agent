/**
 * Bootstrap seed-like git history for services/relay-checkout on this repo.
 * Does NOT create a GitHub repo. Writes add-then-fix commits (backdated),
 * records GitHub Deployments, leaves HEAD + production on the healthy SHA.
 *
 * Usage: pnpm service:bootstrap
 */
import "../src/lib/load-env";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { getEnv } from "../src/lib/env";
import { GitHubReleaseProvider } from "../src/lib/release/github";
import { loadScenarioPatch } from "../src/lib/sim/patches";

const MARKER = join(process.cwd(), "services/relay-checkout/.bootstrap-done");

function git(...args: string[]) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

function daysAgo(days: number, hours = 0): string {
  const d = new Date(Date.now() - days * 86_400_000 - hours * 3_600_000);
  return d.toISOString();
}

function commitWithDate(
  message: string,
  files: Array<{ path: string; content: string }>,
  when: string,
  author: string,
) {
  for (const f of files) {
    mkdirSync(dirname(join(process.cwd(), f.path)), { recursive: true });
    writeFileSync(join(process.cwd(), f.path), f.content, "utf8");
  }
  git("add", "--", ...files.map((f) => f.path));
  execFileSync("git", ["commit", "--allow-empty", "-m", message], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.split("@")[0] ?? "dev"}@relay.dev`,
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: `${author.split("@")[0] ?? "dev"}@relay.dev`,
      GIT_COMMITTER_DATE: when,
    },
    encoding: "utf8",
  });
  return git("rev-parse", "HEAD");
}

async function main() {
  getEnv(); // require GITHUB_TOKEN + GITHUB_REPO

  if (process.env.FORCE_BOOTSTRAP !== "1") {
    try {
      const log = git("log", "--oneline", "--", "services/relay-checkout");
      if (log.split("\n").length >= 4) {
        console.log(
          "services/relay-checkout already has history — skipping (FORCE_BOOTSTRAP=1 to redo).",
        );
        const provider = new GitHubReleaseProvider();
        const current = await provider.currentDeploy();
        if (!current) {
          const head = git("rev-parse", "HEAD");
          await provider.createDeployment(
            head,
            "Bootstrap: ensure production deploy at HEAD",
          );
          console.log(`Created production deployment at ${head.slice(0, 12)}`);
        } else {
          console.log(
            `production already at ${current.sha.slice(0, 12)}: ${current.description}`,
          );
        }
        return;
      }
    } catch {
      // no history yet
    }
  }

  const healthyCheckout = readFileSync(
    join(process.cwd(), "services/relay-checkout/src/checkout.ts"),
    "utf8",
  );
  const healthyPool = readFileSync(
    join(process.cwd(), "services/relay-checkout/src/pool.ts"),
    "utf8",
  );
  const healthyPayments = readFileSync(
    join(process.cwd(), "services/relay-checkout/src/payments.ts"),
    "utf8",
  );
  const healthyCatalog = readFileSync(
    join(process.cwd(), "services/relay-checkout/src/catalog.ts"),
    "utf8",
  );

  const baseFiles = [
    {
      path: "services/relay-checkout/src/checkout.ts",
      content: healthyCheckout,
    },
    { path: "services/relay-checkout/src/catalog.ts", content: healthyCatalog },
    {
      path: "services/relay-checkout/src/payments.ts",
      content: healthyPayments,
    },
    { path: "services/relay-checkout/src/pool.ts", content: healthyPool },
    {
      path: "services/relay-checkout/package.json",
      content: readFileSync(
        join(process.cwd(), "services/relay-checkout/package.json"),
        "utf8",
      ),
    },
  ];

  console.log("Writing seed-like history under services/relay-checkout…");

  // 1. Healthy baseline (~16 days ago)
  const healthySha = commitWithDate(
    "perf: batch catalog lookups in checkout",
    baseFiles,
    daysAgo(16),
    "sam@relay.dev",
  );
  console.log(`  healthy ${healthySha.slice(0, 12)}`);

  // 2. Ship N+1 (~14 days ago) — historical incident
  const nPlus = loadScenarioPatch("n_plus_one");
  const badSha = commitWithDate(
    "feat: per-item product enrichment (introduces N+1)",
    nPlus,
    daysAgo(14, 1),
    "dev@relay.dev",
  );
  console.log(`  n+1 ship ${badSha.slice(0, 12)}`);

  // 3. Revert / fix (~14 days ago + 45m)
  const fixSha = commitWithDate(
    "revert: per-item product enrichment",
    [
      {
        path: "services/relay-checkout/src/checkout.ts",
        content: healthyCheckout,
      },
    ],
    daysAgo(14, 0.25),
    "sam@relay.dev",
  );
  console.log(`  n+1 fix ${fixSha.slice(0, 12)}`);

  // 4. Later healthy commits (not live faults)
  commitWithDate(
    "feat: payments v2 client behind payments_v2 flag",
    [
      {
        path: "services/relay-checkout/src/payments.ts",
        content: healthyPayments,
      },
    ],
    daysAgo(10),
    "pay@relay.dev",
  );
  commitWithDate(
    "fix: handle empty cart metadata",
    [
      {
        path: "services/relay-checkout/src/checkout.ts",
        content: healthyCheckout,
      },
    ],
    daysAgo(7),
    "dev@relay.dev",
  );
  const headSha = commitWithDate(
    "chore: keep db pool at 10 for checkout SLO",
    [{ path: "services/relay-checkout/src/pool.ts", content: healthyPool }],
    daysAgo(2),
    "ops@relay.dev",
  );
  console.log(`  HEAD ${headSha.slice(0, 12)}`);

  writeFileSync(
    MARKER,
    JSON.stringify(
      {
        healthySha,
        badNPlusOneSha: badSha,
        fixedNPlusOneSha: fixSha,
        headSha,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // Push and record deployments (bad then fixed then healthy head)
  console.log("Pushing to origin…");
  try {
    git("push", "origin", "HEAD");
  } catch (err) {
    console.warn(
      "git push failed — create commits locally; push manually then re-run to record deployments.",
      err instanceof Error ? err.message : err,
    );
  }

  const provider = new GitHubReleaseProvider();
  await provider.createDeployment(
    badSha,
    "Historical: N+1 enrichment deploy (rolled back)",
  );
  await provider.createDeployment(fixSha, "Historical: revert N+1 enrichment");
  await provider.createDeployment(
    headSha,
    "Stable checkout with batched catalog lookups",
  );
  console.log("Recorded GitHub production deployments. Demo starts green.");
  console.log(`Bootstrap marker: ${MARKER}`);
  console.log(
    `Historical incident SHAs — bad=${badSha.slice(0, 12)} fixed=${fixSha.slice(0, 12)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
