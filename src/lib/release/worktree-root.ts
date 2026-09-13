import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Writable worktree root. Vercel lambdas can only write under /tmp. */
export function worktreeRoot(): string {
  if (process.env.VERCEL) return join(tmpdir(), "relay-worktrees");
  return resolve(process.cwd(), ".relay-worktrees");
}
