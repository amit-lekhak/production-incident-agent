import { ChaosConsole } from "@/components/chaos/ChaosConsole";

export default function ChaosPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Chaos console</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Inject a fault into Relay Checkout. The ticker samples live latency;
          the watcher opens incidents when alert rules fire.
        </p>
      </header>
      <ChaosConsole />
    </div>
  );
}
