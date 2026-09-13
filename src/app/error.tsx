"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-(--muted)">
        {error.message || "Unexpected UI error"}
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-(--muted)">
          digest: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => reset()}
        className="rounded bg-(--accent) px-3 py-2 text-sm text-white"
      >
        Try again
      </button>
    </div>
  );
}
