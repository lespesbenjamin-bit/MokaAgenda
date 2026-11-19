export interface BusinessIdentity {
  name: string;
  logoUrl: string | null;
  subtitle: string;
}

export function BusinessBadge({ identity }: { identity: BusinessIdentity }) {
  const initials = identity.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
      {identity.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo hébergé sur Supabase Storage
        <img src={identity.logoUrl} alt="" width={36} height={36} className="size-9 rounded-lg border border-border object-cover" />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">{initials}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{identity.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{identity.subtitle}</span>
      </span>
    </div>
  );
}
