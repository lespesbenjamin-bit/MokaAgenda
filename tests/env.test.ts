import { describe, expect, it } from "vitest";
import { parseAppEnv } from "@/lib/env";

describe("parseAppEnv", () => {
  it("reconnaît les environnements valides", () => {
    expect(parseAppEnv("production")).toBe("production");
    expect(parseAppEnv("demo")).toBe("demo");
  });
  it("retombe sur development pour une valeur absente ou invalide (jamais demo par erreur)", () => {
    expect(parseAppEnv(undefined)).toBe("development");
    expect(parseAppEnv("DEMO ")).toBe("development");
  });
});
