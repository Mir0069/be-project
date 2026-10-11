import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EmailBody from "./EmailBody";

describe("EmailBody", () => {
  it("preserves safe email structure and links", () => {
    render(
      <EmailBody
        html={'<p>Hello <strong>GFS</strong></p><ul><li>Glass deck</li></ul><a href="https://example.com">Drawings</a>'}
      />,
    );

    expect(screen.getByText("GFS").tagName).toBe("STRONG");
    expect(screen.getByText("Glass deck").closest("li")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Drawings" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("removes executable content and remote images", () => {
    const { container } = render(
      <EmailBody
        html={'<p onclick="alert(1)">Safe text</p><script>alert(1)</script><img src="https://tracker.example/pixel.png"><a href="javascript:alert(1)">Unsafe link</a>'}
      />,
    );

    expect(screen.getByText("Safe text")).not.toHaveAttribute("onclick");
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("Unsafe link")).not.toHaveAttribute("href");
  });

  it("uses plain text when HTML is unavailable", () => {
    render(<EmailBody text={"Hello,\nPlease review the drawings."} />);

    expect(screen.getByText(/Please review the drawings/)).toBeInTheDocument();
  });
});
