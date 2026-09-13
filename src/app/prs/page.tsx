import Link from "next/link";
import { listPendingReviews } from "@/lib/review/pending";
import { ReviewQueueList } from "@/components/review/ReviewQueueList";

export const dynamic = "force-dynamic";

export default async function PrsPage() {
  const rows = await listPendingReviews("with_pr");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">PRs</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Revert PRs opened by diagnose. Merge applies the fix and redeploys;
          Close abandons the PR. The model never writes to git. Non-PR decisions
          are on{" "}
          <Link href="/review" className="text-(--accent) underline">
            Review
          </Link>
          .
        </p>
      </header>

      <ReviewQueueList
        rows={rows}
        hasPr={true}
        emptyMessage="No open revert PRs. Diagnose a revert to see one here."
      />
    </div>
  );
}
