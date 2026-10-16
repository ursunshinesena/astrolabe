import { Agent } from "@/components/agent";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-16 pb-24 sm:px-6">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.3em] text-brass">Astrolabe</p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
          Dollars to euros, from any chain.
          <br />
          <span className="text-muted">Settled on Arc.</span>
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          Say what you want. Astrolabe prices every chain, picks the route, waits for your approval,
          then bridges with CCTP V2 and swaps on Arc. Every step is persisted and every transaction
          is on the explorer.
        </p>
      </header>
      <Agent />
    </main>
  );
}
