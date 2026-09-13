"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-white p-8 font-sans text-zinc-900">
        <h1 className="text-xl font-semibold">Application error</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {error.message || "Unexpected failure"}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded bg-zinc-900 px-3 py-2 text-sm text-white"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
