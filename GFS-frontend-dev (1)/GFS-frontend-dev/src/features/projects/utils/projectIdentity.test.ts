import { describe, expect, it } from "vitest";

import {
  formatProjectAddress,
  getProjectIdentity,
} from "./projectIdentity";

describe("projectIdentity", () => {
  it("uses the canonical project address without duplicating structured fields", () => {
    expect(
      formatProjectAddress("159 Poppasquash Road, Bristol, RI 02809", {
        street: "Different Street",
        city: "Bristol",
        state: "RI",
        zipcode: "02809",
        country: "US",
      }),
    ).toBe("159 Poppasquash Road, Bristol, RI 02809");
  });

  it("builds an address from backend components when jobAddress is absent", () => {
    expect(
      formatProjectAddress(null, {
        street: "4 Jane Street",
        city: "New York",
        state: "NY",
        zipcode: null,
        country: "US",
      }),
    ).toBe("4 Jane Street, New York, NY, US");
  });

  it("falls back to the project name when no address is available", () => {
    expect(
      getProjectIdentity({
        jobAddress: null,
        address: null,
        projectName: "Wilcox Residence",
      }),
    ).toBe("Wilcox Residence");
  });
});
