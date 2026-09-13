import Link from "next/link";
import { listPendingReviews } from "@/lib/review/pending";
import { ReviewQueueList } from "@/components/review/ReviewQueueList";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const rows = await listPendingReviews("without_pr");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Approve or reject recommendations that do not open a GitHub PR (page
          on-call, watch, restart, disable flag). Revert PRs live on{" "}
          <Link href="/prs" className="text-(--accent) underline">
            PRs
          </Link>
          .
        </p>
      </header>

      <ReviewQueueList
        rows={rows}
        hasPr={false}
        emptyMessage="No decisions waiting."
      />
    </div>
  );
}
