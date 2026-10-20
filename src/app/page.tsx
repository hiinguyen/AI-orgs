export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-xl space-y-4 text-center">
        <p className="eyebrow text-signal">AI Agent World</p>
        <h1 className="text-3xl font-semibold tracking-tight text-mist-100">
          {`Six agents, one office, a deterministic simulation`}
        </h1>
        <p className="text-sm leading-6 text-mist-300">
          AI Agent World - Simulation mode, no live inference
        </p>
        <p className="text-xs leading-5 text-mist-500">
          The world, panels and controls arrive in the next phase. The
          simulation engine and domain model are already running headless.
        </p>
      </div>
    </main>
  );
}
