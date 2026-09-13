export type DeployRecord = {
  sha: string;
  environment: string;
  description: string;
  createdAt: string;
  id?: number;
};

export type CommitRecord = {
  sha: string;
  message: string;
  author: string;
  committedAt: string;
  filesChanged: string[];
};

export type PrRecord = {
  number: number;
  url: string;
  title: string;
  headSha: string;
  baseSha: string;
};

export type OpenRevertPrInput = {
  /** SHA of the bad deploy to revert */
  sha: string;
  title: string;
  body: string;
  /** Optional previous good SHA (base for revert). Defaults to parent of sha. */
  restoreSha?: string;
};

export type ReleaseProvider = {
  currentDeploy(): Promise<DeployRecord | null>;
  listDeployments(limit?: number): Promise<DeployRecord[]>;
  listCommits(limit?: number): Promise<CommitRecord[]>;
  getFile(sha: string, path: string): Promise<string>;
  diff(base: string, head: string): Promise<string>;
  createDeployment(sha: string, summary: string): Promise<DeployRecord>;
  openRevertPr(input: OpenRevertPrInput): Promise<PrRecord>;
  mergePr(number: number): Promise<{ sha: string; merged: boolean }>;
  closePr(number: number): Promise<void>;
  /** Materialize services/relay-checkout tree at sha into a local workdir. */
  checkoutDeployed(sha: string): Promise<string>;
  /** Commit + push service-path changes; returns new SHA. */
  commitAndPush(input: {
    message: string;
    files: Array<{ path: string; content: string }>;
    branch?: string;
  }): Promise<{ sha: string }>;
};
