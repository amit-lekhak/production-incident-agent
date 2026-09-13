import { ChaosConsole } from "@/components/chaos/ChaosConsole";

export default function ChaosPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Chaos</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Ship a bad checkout patch to production, then let the watcher open an
          incident when latency or errors breach the alert rules.
        </p>
      </header>
      <ChaosConsole />
    </div>
  );
}
