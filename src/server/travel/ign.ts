import "server-only";
import { ProviderError, type GeocodeCandidate, type RouteResult, type TravelProvider } from "./provider";
import { RateLimiter } from "./limiter";

/**
 * IGN Géoplateforme (service public, gratuit, sans clé).
 *  • géocodage : https://data.geopf.fr/geocodage/search (BAN) — 50 requêtes/s par IP ;
 *  • itinéraire : https://data.geopf.fr/navigation/itineraire (BD TOPO, OSRM) — 5 requêtes/s par IP.
 * Pas de trafic en temps réel : compensé par la marge de sécurité configurable.
 */
const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
const ROUTE_URL = "https://data.geopf.fr/navigation/itineraire";
const TIMEOUT_MS = 8000;

const routeLimiter = new RateLimiter(4, 4); // marge sous la limite publique de 5/s
const geocodeLimiter = new RateLimiter(20, 4);

async function getJson(url: string, limiter: RateLimiter, fetchImpl: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await limiter.run(() => fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } })).catch((e: unknown) => {
      throw new ProviderError("unavailable", e instanceof Error ? e.message : "réseau");
    });
    if (res.status === 429) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw new ProviderError("quota", "Limite de requêtes du service IGN atteinte");
    }
    if (res.status >= 500) {
      if (attempt === 0) continue;
      throw new ProviderError("unavailable", `Service IGN indisponible (${res.status})`);
    }
    if (!res.ok) throw new ProviderError("invalid", `Requête refusée par le service IGN (${res.status})`);
    return res.json();
  }
  throw new ProviderError("unavailable", "Service IGN indisponible");
}

interface IgnFeature {
  geometry: { coordinates: [number, number] };
  properties: { label: string; score: number; postcode?: string; city?: string; type?: string };
}

export function parseIgnGeocode(json: unknown): GeocodeCandidate[] {
  const features = (json as { features?: IgnFeature[] })?.features ?? [];
  return features
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f) => ({
      label: f.properties.label,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      postcode: f.properties.postcode ?? null,
      city: f.properties.city ?? null,
      score: Number(f.properties.score) || 0,
      precision: f.properties.type === "housenumber" ? "housenumber" : f.properties.type === "street" ? "street" : "other",
    }));
}

export function parseIgnRoute(json: unknown): RouteResult {
  const j = json as { distance?: number; duration?: number; distanceUnit?: string; timeUnit?: string; geometry?: { coordinates?: [number, number][] } | string };
  if (typeof j?.distance !== "number" || typeof j?.duration !== "number") throw new ProviderError("not_found", "Itinéraire introuvable");
  if (j.distanceUnit && j.distanceUnit !== "meter") throw new ProviderError("invalid", "Unité de distance inattendue");
  if (j.timeUnit && j.timeUnit !== "second") throw new ProviderError("invalid", "Unité de temps inattendue");
  const coords = typeof j.geometry === "object" && Array.isArray(j.geometry?.coordinates) ? j.geometry.coordinates : null;
  // Tracé allégé (≤ 200 points) pour l'affichage uniquement
  const step = coords ? Math.max(1, Math.ceil(coords.length / 200)) : 1;
  const geometry = coords ? coords.filter((_, i) => i % step === 0 || i === coords.length - 1).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))] as [number, number]) : null;
  return { distanceM: Math.round(j.distance), durationS: Math.round(j.duration), geometry };
}

export function createIgnProvider(fetchImpl: typeof fetch = fetch): TravelProvider {
  return {
    name: "ign",
    liveTraffic: false,
    async geocode(query, opts) {
      const u = new URL(GEOCODE_URL);
      u.searchParams.set("q", query.slice(0, 200));
      u.searchParams.set("limit", "5");
      u.searchParams.set("index", "address");
      if (opts?.postcode) u.searchParams.set("postcode", opts.postcode);
      return parseIgnGeocode(await getJson(u.toString(), geocodeLimiter, fetchImpl));
    },
    async route(from, to, profile) {
      const u = new URL(ROUTE_URL);
      u.searchParams.set("resource", "bdtopo-osrm");
      u.searchParams.set("start", `${from.lng},${from.lat}`);
      u.searchParams.set("end", `${to.lng},${to.lat}`);
      u.searchParams.set("profile", profile);
      u.searchParams.set("optimization", "fastest");
      u.searchParams.set("getSteps", "false");
      u.searchParams.set("distanceUnit", "meter");
      u.searchParams.set("timeUnit", "second");
      u.searchParams.set("geometryFormat", "geojson");
      return parseIgnRoute(await getJson(u.toString(), routeLimiter, fetchImpl));
    },
  };
}
