import { afterEach, describe, expect, it } from "vitest";
import { createIgnProvider, parseIgnGeocode, parseIgnRoute } from "@/server/travel/ign";
import { ProviderError, type TravelProvider } from "@/server/travel/provider";
import { classifyGeocode, geocodeAddress, makeGeoToken, readGeoToken, setTravelProviderForTests, signLeg, travelSecret } from "@/server/travel/service";
import { RateLimiter } from "@/server/travel/limiter";
import { routeMessage, verify } from "@/server/travel/signing";

/**
 * Adaptateur IGN testé SANS réseau : les réponses ci-dessous reprennent la
 * structure réelle relevée sur data.geopf.fr (géocodage et itinéraire) le
 * 20/11/2026. Les valeurs numériques sont des exemples, pas des trajets réels.
 */
const GEOCODE_SAMPLE = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [1.4437, 43.6044] }, properties: { label: "1 Place du Capitole 31000 Toulouse", score: 0.97, housenumber: "1", postcode: "31000", city: "Toulouse", type: "housenumber" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [1.444, 43.604] }, properties: { label: "Place du Capitole 31000 Toulouse", score: 0.71, postcode: "31000", city: "Toulouse", type: "street" } },
  ],
};
const ROUTE_SAMPLE = {
  resource: "bdtopo-osrm",
  distance: 10321.4,
  duration: 1087.6,
  distanceUnit: "meter",
  timeUnit: "second",
  geometry: { type: "LineString", coordinates: Array.from({ length: 450 }, (_, i) => [1.44 - i * 0.0002, 43.6 + i * 0.00002]) },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => setTravelProviderForTests(null));

describe("adaptateur IGN Géoplateforme", () => {
  it("lit le géocodage (coordonnées [lng, lat], score, précision)", () => {
    const c = parseIgnGeocode(GEOCODE_SAMPLE);
    expect(c[0]).toEqual({ label: "1 Place du Capitole 31000 Toulouse", lng: 1.4437, lat: 43.6044, postcode: "31000", city: "Toulouse", score: 0.97, precision: "housenumber" });
    expect(c[1].precision).toBe("street");
  });

  it("lit l'itinéraire en mètres et secondes, allège le tracé", () => {
    const r = parseIgnRoute(ROUTE_SAMPLE);
    expect(r.distanceM).toBe(10321);
    expect(r.durationS).toBe(1088);
    expect(r.geometry!.length).toBeLessThanOrEqual(201);
  });

  it("refuse une réponse sans distance ou dans une unité inattendue (aucune valeur inventée)", () => {
    expect(() => parseIgnRoute({})).toThrow(ProviderError);
    expect(() => parseIgnRoute({ ...ROUTE_SAMPLE, distanceUnit: "kilometer" })).toThrow(/Unité/);
  });

  it("construit les bonnes requêtes (adresse, profil voiture, départ/arrivée lng,lat)", async () => {
    const urls: string[] = [];
    const p = createIgnProvider((async (u: string) => {
      urls.push(u);
      return u.includes("geocodage") ? json(GEOCODE_SAMPLE) : json(ROUTE_SAMPLE);
    }) as unknown as typeof fetch);
    await p.geocode("1 place du Capitole Toulouse", { postcode: "31000" });
    await p.route({ lat: 43.6, lng: 1.44 }, { lat: 43.61, lng: 1.33 }, "car");
    expect(urls[0]).toContain("data.geopf.fr/geocodage/search");
    expect(urls[0]).toContain("postcode=31000");
    expect(urls[1]).toContain("start=1.44%2C43.6");
    expect(urls[1]).toContain("profile=car");
    expect(urls[1]).toContain("resource=bdtopo-osrm");
  });

  it("service indisponible ou quota dépassé : erreur explicite, après une nouvelle tentative", async () => {
    let calls = 0;
    const down = createIgnProvider((async () => {
      calls++;
      return json({ error: "x" }, 503);
    }) as unknown as typeof fetch);
    await expect(down.route({ lat: 43.6, lng: 1.4 }, { lat: 43.7, lng: 1.5 }, "car")).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(2);
    const quota = createIgnProvider((async () => json({}, 429)) as unknown as typeof fetch);
    await expect(quota.route({ lat: 43.6, lng: 1.4 }, { lat: 43.7, lng: 1.5 }, "car")).rejects.toMatchObject({ kind: "quota" });
    const offline = createIgnProvider((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(offline.geocode("x y z")).rejects.toMatchObject({ kind: "unavailable" });
  }, 10_000);
});

describe("validation des adresses", () => {
  const cand = (label: string, score: number, precision: "housenumber" | "street" | "other" = "housenumber") => ({ label, score, precision, lat: 43.6, lng: 1.4, postcode: "31000", city: "Toulouse" });
  it("résultat unique et sûr → accepté", () => {
    expect(classifyGeocode([cand("1 rue A", 0.95), cand("rue A", 0.6, "street")])).toMatchObject({ status: "ok", precise: true });
  });
  it("deux adresses proches en score → demande de choisir", () => {
    expect(classifyGeocode([cand("1 rue A Toulouse", 0.9), cand("1 rue A Blagnac", 0.89)])).toMatchObject({ status: "ambiguous" });
  });
  it("score faible → demande de préciser ; rien d'exploitable → introuvable", () => {
    expect(classifyGeocode([cand("rue B", 0.6, "street")])).toMatchObject({ status: "ambiguous" });
    expect(classifyGeocode([cand("Toulouse", 0.9, "other")])).toEqual({ status: "not_found" });
    expect(classifyGeocode([])).toEqual({ status: "not_found" });
  });
  it("fournisseur indisponible → « indisponible », jamais une adresse supposée", async () => {
    const failing: TravelProvider = {
      name: "test",
      liveTraffic: false,
      geocode: async () => {
        throw new ProviderError("unavailable", "down");
      },
      route: async () => {
        throw new ProviderError("unavailable", "down");
      },
    };
    setTravelProviderForTests(failing);
    expect((await geocodeAddress({ line1: "3 allée Inconnue", postalCode: "31000", city: "Toulouse" })).status).toBe("unavailable");
  });
});

describe("jetons signés", () => {
  const secret = "a".repeat(64);
  it("clé serveur : 64 caractères hexadécimaux requis", () => {
    expect(travelSecret({ TRAVEL_SIGNING_SECRET: secret })).toBe(secret);
    expect(travelSecret({ TRAVEL_SIGNING_SECRET: "trop-court" })).toBeNull();
    expect(travelSecret({})).toBeNull();
  });
  it("adresse vérifiée : jeton lié à l'entreprise, infalsifiable et à durée limitée", () => {
    const tok = makeGeoToken(secret, "biz-1", { label: "1 rue A", lat: 43.6044123, lng: 1.4437, postcode: "31000", city: "Toulouse", score: 0.9, precision: "housenumber" });
    expect(tok.lat).toBe(43.604412);
    expect(readGeoToken(secret, "biz-1", tok)).not.toBeNull();
    expect(readGeoToken(secret, "biz-2", tok)).toBeNull();
    expect(readGeoToken(secret, "biz-1", { ...tok, lat: 43.7 })).toBeNull();
    expect(readGeoToken(secret, "biz-1", { ...tok, expires_epoch: 1 })).toBeNull();
    expect(readGeoToken(secret, "biz-1", "n'importe quoi")).toBeNull();
  });
  it("trajet signé : la signature couvre distance, durée, fournisseur et date", () => {
    const l = signLeg(secret, "biz-1", { lat: 43.6, lng: 1.4 }, { lat: 43.7, lng: 1.5 }, { distanceM: 12000, durationS: 900, geometry: null }, "ign");
    const msg = routeMessage({ businessId: "biz-1", from: l.from, to: l.to, distanceM: 12000, durationS: 900, provider: "ign", computedEpoch: l.computedEpoch });
    expect(verify(msg, l.signature, secret)).toBe(true);
    expect(verify(msg.replace("|12000|", "|100|"), l.signature, secret)).toBe(false);
  });
});

describe("limitation des appels au fournisseur", () => {
  it("ne dépasse pas N appels par seconde", async () => {
    const lim = new RateLimiter(3, 10);
    const t0 = Date.now();
    const stamps: number[] = [];
    await Promise.all(Array.from({ length: 6 }, () => lim.run(async () => stamps.push(Date.now() - t0))));
    stamps.sort((a, b) => a - b);
    expect(stamps[3]).toBeGreaterThanOrEqual(900);
  });
});
