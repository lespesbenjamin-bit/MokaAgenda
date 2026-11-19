export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="h-4 w-40 rounded bg-secondary" />
      <div className="mt-3 h-9 w-64 rounded-lg bg-secondary" />
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="h-36 rounded-2xl bg-secondary lg:col-span-2" />
        <div className="h-36 rounded-2xl bg-secondary" />
      </div>
    </div>
  );
}
