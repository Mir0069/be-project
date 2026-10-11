import { describe, expect, it } from "vitest";

import { getUserManagementErrorMessage } from "./utils";

describe("getUserManagementErrorMessage", () => {
  it("explains duplicate emails from the API client error shape", () => {
    expect(
      getUserManagementErrorMessage(
        {
          status: 409,
          message: "User already exists with this email",
          data: { error: { code: "CONFLICT" } },
        },
        "Fallback",
      ),
    ).toBe("A user with this email already exists. Please use a different email address.");
  });

  it("preserves a useful non-conflict API message", () => {
    expect(
      getUserManagementErrorMessage(
        { status: 500, message: "Unable to create user" },
        "Fallback",
      ),
    ).toBe("Unable to create user");
  });

  it("uses the fallback for an unknown error", () => {
    expect(getUserManagementErrorMessage(new Error(), "Fallback")).toBe("Fallback");
  });
});
