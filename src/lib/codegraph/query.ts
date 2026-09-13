import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ignore from "ignore";
import {
  approxTokens,
  DEFAULT_TOKEN_BUDGET,
  isBlockedPath,
  truncateToBudget,
  type CodeGraph,
  type GraphNode,
} from "./types";

const FIXTURE_ROOT = join(process.cwd(), "services/relay-checkout");
const GRAPH_PATH = join(FIXTURE_ROOT, "graphify-out/graph.json");

let cached: CodeGraph | null = null;

export function loadGraph(): CodeGraph {
  if (cached) return cached;
  if (!existsSync(GRAPH_PATH)) {
    cached = { nodes: [], edges: [], meta: { empty: true } };
    return cached;
  }
  const raw = JSON.parse(readFileSync(GRAPH_PATH, "utf8")) as CodeGraph;
  cached = raw;
  return raw;
}

export function clearGraphCache() {
  cached = null;
}

function scoreNode(node: GraphNode, q: string): number {
  const hay =
    `${node.id} ${node.name} ${node.file} ${node.summary}`.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const t of terms) {
    if (hay.includes(t)) score += 2;
    if (node.name.toLowerCase() === t) score += 5;
  }
  return score;
}

export function codeQuery(question: string, budget = DEFAULT_TOKEN_BUDGET) {
  const graph = loadGraph();
  if (graph.nodes.length === 0) {
    return fallbackGlob(question, budget);
  }

  const ranked = graph.nodes
    .map((n) => ({ n, score: scoreNode(n, question) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const relatedEdges = graph.edges.filter((e) =>
    ranked.some((r) => r.n.id === e.from || r.n.id === e.to),
  );

  const payload = {
    display: `code_query: ${ranked.length} nodes for "${question}"`,
    nodes: ranked.map(({ n, score }) => ({
      id: n.id,
      name: n.name,
      file: n.file,
      line: n.line,
      summary: n.summary,
      score,
    })),
    edges: relatedEdges,
    source: "graph.json",
  };

  const text = truncateToBudget(JSON.stringify(payload, null, 2), budget);
  return {
    ...payload,
    text,
    tokensApprox: approxTokens(text),
    blockedPathsRejected: true,
  };
}

export function codeExplain(symbol: string, budget = DEFAULT_TOKEN_BUDGET) {
  const graph = loadGraph();
  const node =
    graph.nodes.find((n) => n.id === symbol || n.name === symbol) ??
    graph.nodes.find((n) => n.name.toLowerCase() === symbol.toLowerCase());

  if (!node) {
    return {
      display: `code_explain: ${symbol} not found`,
      found: false,
      text: truncateToBudget(JSON.stringify({ found: false, symbol }), budget),
      tokensApprox: 20,
    };
  }

  const edges = graph.edges.filter(
    (e) => e.from === node.id || e.to === node.id,
  );
  const neighbors = edges.map((e) => {
    const otherId = e.from === node.id ? e.to : e.from;
    const other = graph.nodes.find((n) => n.id === otherId);
    return { edge: e, neighbor: other ?? { id: otherId } };
  });

  const payload = {
    display: `code_explain: ${node.name} @ ${node.file}:${node.line}`,
    found: true,
    node,
    neighbors,
    source: "graph.json",
  };
  const text = truncateToBudget(JSON.stringify(payload, null, 2), budget);
  return { ...payload, text, tokensApprox: approxTokens(text) };
}

export function codePath(
  from: string,
  to: string,
  budget = DEFAULT_TOKEN_BUDGET,
) {
  const graph = loadGraph();
  const start =
    graph.nodes.find((n) => n.id === from || n.name === from)?.id ?? from;
  const goal = graph.nodes.find((n) => n.id === to || n.name === to)?.id ?? to;

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.to)!.push(e.from);
  }

  const queue = [start];
  const prev = new Map<string, string | null>([[start, null]]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) break;
    for (const nxt of adj.get(cur) ?? []) {
      if (!prev.has(nxt)) {
        prev.set(nxt, cur);
        queue.push(nxt);
      }
    }
  }

  const path: string[] = [];
  if (prev.has(goal)) {
    let cur: string | null = goal;
    while (cur) {
      path.unshift(cur);
      cur = prev.get(cur) ?? null;
    }
  }

  const payload = {
    display:
      path.length > 0
        ? `code_path: ${path.join(" → ")}`
        : `code_path: no path ${from} → ${to}`,
    from: start,
    to: goal,
    path,
    hops: Math.max(0, path.length - 1),
    source: "graph.json",
  };
  const text = truncateToBudget(JSON.stringify(payload, null, 2), budget);
  return { ...payload, text, tokensApprox: approxTokens(text) };
}

function fallbackGlob(question: string, budget: number) {
  const ig = ignore().add([
    "node_modules",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    ".next",
    "dist",
    "coverage",
    "graphify-out",
    ".env",
    ".env.*",
  ]);

  const files: string[] = [];
  function walk(dir: string) {
    for (const ent of readdirSync(dir)) {
      const full = join(dir, ent);
      const rel = relative(FIXTURE_ROOT, full);
      if (ig.ignores(rel) || isBlockedPath(rel)) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|md)$/.test(ent)) files.push(rel);
    }
  }
  if (existsSync(join(FIXTURE_ROOT, "src"))) walk(join(FIXTURE_ROOT, "src"));

  const terms = question.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = files
    .map((f) => {
      const body = readFileSync(join(FIXTURE_ROOT, f), "utf8");
      const score = terms.reduce(
        (s, t) => s + (body.toLowerCase().includes(t) ? 1 : 0),
        0,
      );
      return { file: f, score, snippet: body.slice(0, 400) };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const payload = {
    display: `code_query fallback glob: ${hits.length} files`,
    source: "glob_fallback",
    hits,
  };
  const text = truncateToBudget(JSON.stringify(payload, null, 2), budget);
  return {
    ...payload,
    text,
    tokensApprox: approxTokens(text),
    blockedPathsRejected: true,
  };
}
