export type GraphNode = {
  id: string;
  kind: string;
  name: string;
  file: string;
  line: number;
  summary: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  rel: string;
  confidence: string;
};

export type CodeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: Record<string, unknown>;
};

export const DEFAULT_TOKEN_BUDGET = 1500;

const BLOCKED = [
  "node_modules",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  ".next",
  "dist",
  "coverage",
  "graphify-out",
];

export function isBlockedPath(p: string): boolean {
  const parts = p.split(/[\\/]/);
  return BLOCKED.some((b) => parts.includes(b) || p.endsWith(b));
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToBudget(text: string, budget: number): string {
  const maxChars = budget * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated to ~${budget} tokens]`;
}
