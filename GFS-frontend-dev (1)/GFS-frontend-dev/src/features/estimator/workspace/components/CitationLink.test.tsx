import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitationLink } from "./CitationLink";

const { useDocumentsMock } = vi.hoisted(() => ({
  useDocumentsMock: vi.fn(),
}));

vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDocuments: useDocumentsMock,
}));

describe("CitationLink", () => {
  beforeEach(() => {
    useDocumentsMock.mockReturnValue({ data: [] });
  });

  it("keeps a PDF filename display-only when interactivity is not requested", () => {
    const openSpy = vi.spyOn(window, "open");

    render(
      <CitationLink
        projectId="project-1"
        citationText="📄 floor-plan.pdf (p.2)"
        docName="floor-plan.pdf"
        pageNumber={2}
      />,
    );

    expect(screen.getByText("floor-plan.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(useDocumentsMock).toHaveBeenCalledWith(undefined);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("opens an available PDF citation", () => {
    useDocumentsMock.mockReturnValue({
      data: [{ id: "doc-1", originalName: "floor-plan.pdf" }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="floor-plan.pdf (p.2)"
        docName="floor-plan.pdf"
        pageNumber={2}
        interactive
      />,
    );

    expect(screen.getByRole("button", { name: /floor-plan\.pdf/i })).toBeInTheDocument();
  });

  it("opens common documentation formats when the document is available", () => {
    useDocumentsMock.mockReturnValue({
      data: [{ id: "doc-1", originalName: "specification.docx" }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="specification.docx"
        docName="specification.docx"
        interactive
      />,
    );

    expect(screen.getByRole("button", { name: /specification\.docx/i })).toBeInTheDocument();
  });

  it("keeps email-body citations static and does not fetch or open them", () => {
    const openSpy = vi.spyOn(window, "open");
    useDocumentsMock.mockReturnValue({
      data: [{
        id: "mail-1",
        originalName: "email-123.txt",
        metadata: { emailId: "email-123" },
      }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="Email Thread (p.2)"
        docName="Quote Request"
        sourceType="email_body"
        interactive
      />,
    );

    expect(screen.getByText("Email Thread")).toBeInTheDocument();
    expect(screen.getByTitle(/Email cannot be opened here/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(useDocumentsMock).toHaveBeenCalledWith(undefined);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("renders non-clickable badge for rule-engine citations", () => {
    render(
      <CitationLink
        projectId="project-1"
        citationText="AI Inferred"
        docName="AI Inferred"
        sourceType="rule_engine"
        interactive
      />,
    );

    expect(screen.getByText("AI-assisted")).toBeInTheDocument();
    expect(screen.getByTitle(/AI inferred/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens a PDF attachment even when it is linked to an email", () => {
    useDocumentsMock.mockReturnValue({
      data: [{
        id: "attachment-1",
        originalName: "request.pdf",
        metadata: { emailId: "message-123", source: "cloud-link" },
      }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="request.pdf"
        docName="request.pdf"
        interactive
      />,
    );

    expect(screen.getByRole("button", { name: /request\.pdf/i })).toBeInTheDocument();
  });

  it("blocks an explicitly marked email-body document even when its filename is a PDF", () => {
    const openSpy = vi.spyOn(window, "open");
    useDocumentsMock.mockReturnValue({
      data: [{
        id: "mail-1",
        originalName: "request.pdf",
        metadata: { kind: "email-body" },
      }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="request.pdf"
        docName="request.pdf"
        interactive
      />,
    );

    expect(screen.getByText("request.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("keeps AI Insight interactive when the cited document is available", () => {
    useDocumentsMock.mockReturnValue({
      data: [{ id: "doc-1", originalName: "Sheet.pdf" }],
    });

    render(
      <CitationLink
        projectId="project-1"
        citationText="Sheet.pdf (p.2)"
        docName="Sheet.pdf"
        interactive
      />,
    );

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("falls back to a static filename when an interactive document is unavailable", () => {
    render(
      <CitationLink
        projectId="project-1"
        citationText="Sheet.pdf (p.2)"
        docName="Sheet.pdf"
        interactive
      />,
    );

    expect(screen.getByText("Sheet.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not guess a document when an interactive citation has no filename", () => {
    const { container } = render(
      <CitationLink
        projectId="project-1"
        citationText="Sheet (p.2)"
        interactive
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not render a non-PDF static citation", () => {
    const { container } = render(
      <CitationLink projectId="project-1" citationText="Drawing (p.2)" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
