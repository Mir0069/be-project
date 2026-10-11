import { describe, expect, it } from "vitest";
import {
  getPasswordPolicyErrors,
  getPasswordPolicyChecks,
} from "./passwordPolicy";

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(getPasswordPolicyErrors("GfsSecure!2026")).toEqual([]);
  });

  it("reports the required password characteristics", () => {
    const checks = getPasswordPolicyChecks("short");

    expect(checks.minLength).toBe(false);
    expect(checks.complexity).toBe(false);
    expect(checks.maxBytes).toBe(true);
  });

  it("requires all four character types", () => {
    expect(getPasswordPolicyErrors("Abcdefg1")).toContain(
      "Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.",
    );
    expect(getPasswordPolicyErrors("Abcdef1!")).toEqual([]);
  });

  it("rejects common and personal passwords", () => {
    expect(getPasswordPolicyErrors("Password@123")).toContain(
      "Password is too common. Choose a less predictable password.",
    );
    expect(getPasswordPolicyErrors("AliceSecure!2026", {
      email: "alice@example.com",
      firstName: "Alice",
    })).toContain("Password must not contain your name or email address.");
  });

  it("rejects meaningful fragments of a user name", () => {
    expect(getPasswordPolicyErrors("JemuSecure!2026", {
      email: "jsheta150@gmail.com",
      firstName: "Jemunesh",
    })).toContain("Password must not contain your name or email address.");
  });
});
