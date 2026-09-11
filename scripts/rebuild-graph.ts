import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import "../src/lib/load-env";

const FIXTURE = join(process.cwd(), "fixtures/relay-checkout");
const OUT = join(FIXTURE, "graphify-out");

/**
 * Prefer Graphify CLI when installed; otherwise rebuild a minimal AST-ish graph
 * from fixtures/relay-checkout/src so demos never require Python.
 */
function main() {
  mkdirSync(OUT, { recursive: true });
  const graphify = spawnSync("graphify", ["extract", FIXTURE], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  if (graphify.status === 0) {
    console.log("graphify extract succeeded");
    return;
  }

  console.warn(
    "graphify CLI unavailable — writing fallback graph.json from fixture sources",
  );
  const srcDir = join(FIXTURE, "src");
  const files: string[] = [];
  function walk(dir: string) {
    for (const ent of readdirSync(dir)) {
      const full = join(dir, ent);
      if (statSync(full).isDirectory()) walk(full);
      else if (ent.endsWith(".ts")) files.push(relative(FIXTURE, full));
    }
  }
  walk(srcDir);

  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const fileId = `file:${file}`;
    nodes.push({
      id: fileId,
      kind: "file",
      name: file,
      file,
      line: 1,
      summary: `Fixture source ${file}`,
    });
    const body = readFileSync(join(FIXTURE, file), "utf8");
    const fnRe =
      /(?:export\s+)?async\s+function\s+(\w+)|(?:export\s+)?function\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(body))) {
      const name = m[1] ?? m[2]!;
      const line = body.slice(0, m.index).split("\n").length;
      const id = name;
      nodes.push({
        id,
        kind: "function",
        name,
        file,
        line,
        summary: `Function ${name} in ${file}`,
      });
      edges.push({
        from: fileId,
        to: id,
        rel: "defines",
        confidence: "EXTRACTED",
      });
    }
    if (body.includes("lookupProduct")) {
      edges.push({
        from: "checkout",
        to: "lookupProduct",
        rel: "calls",
        confidence: "INFERRED",
      });
    }
    if (body.includes("chargePayment")) {
      edges.push({
        from: "checkout",
        to: "chargePayment",
        rel: "calls",
        confidence: "INFERRED",
      });
    }
  }

  // de-dupe nodes by id
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const graph = {
    nodes: [...byId.values()],
    edges,
    meta: {
      source: "fixtures/relay-checkout",
      generator: existsSync(join(OUT, "graph.json"))
        ? "rebuild-fallback"
        : "rebuild-fallback-new",
    },
  };
  writeFileSync(join(OUT, "graph.json"), JSON.stringify(graph, null, 2));
  console.log(`Wrote ${join(OUT, "graph.json")} with ${byId.size} nodes`);
}

main();
