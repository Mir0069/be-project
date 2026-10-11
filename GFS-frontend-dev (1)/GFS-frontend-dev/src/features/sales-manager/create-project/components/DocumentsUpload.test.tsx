import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setProjectData: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  showToast: mocks.showToast,
}));

vi.mock("../context/CreateProjectContext", () => ({
  useCreateProject: () => ({
    projectData: {
      formData: {
        projectDetails: { projectId: "project-1" },
        documents: [],
      },
    },
    setProjectData: mocks.setProjectData,
  }),
}));

vi.mock("@/shared/lib/filePreview", () => ({
  openStagedBlobInWindow: vi.fn(),
}));

import DocumentsUpload from "./DocumentsUpload";

const file = (name: string, type: string) =>
  new File(["file contents"], name, { type });

describe("DocumentsUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "document-1" });
  });

  it("shows the drag-and-drop upload target", () => {
    render(<DocumentsUpload />);

    expect(
      screen.getByLabelText("Upload project documents"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Click to upload or drag and drop",
      }),
    ).toBeInTheDocument();
  });

  it("uploads supported files dropped on the target", async () => {
    render(<DocumentsUpload />);
    const target = screen.getByLabelText("Upload project documents");
    const pdf = file("plans.pdf", "application/pdf");
    const dataTransfer = {
      files: [pdf],
      types: ["Files"],
      dropEffect: "none",
    };

    fireEvent.dragEnter(target, { dataTransfer });
    expect(
      screen.getByRole("heading", { name: "Drop files to upload" }),
    ).toBeInTheDocument();

    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        "success",
        "1 file uploaded successfully",
      );
    });

    expect(screen.getByText("plans.pdf")).toBeInTheDocument();
    expect(mocks.setProjectData).toHaveBeenCalled();
  });

  it("does not add unsupported dropped files", async () => {
    render(<DocumentsUpload />);
    const target = screen.getByLabelText("Upload project documents");

    fireEvent.drop(target, {
      dataTransfer: {
        files: [file("notes.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")],
        types: ["Files"],
        dropEffect: "none",
      },
    });

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalled();
    });

    expect(screen.queryByText("notes.xlsx")).not.toBeInTheDocument();
    expect(screen.getByText("No files uploaded")).toBeInTheDocument();
  });

  it("clears the drag state when the pointer leaves the target", () => {
    render(<DocumentsUpload />);
    const target = screen.getByLabelText("Upload project documents");
    const dataTransfer = {
      files: [],
      types: ["Files"],
      dropEffect: "none",
    };

    fireEvent.dragOver(target, { dataTransfer });
    expect(
      screen.getByRole("heading", { name: "Drop files to upload" }),
    ).toBeInTheDocument();

    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: null });
    expect(
      screen.getByRole("heading", {
        name: "Click to upload or drag and drop",
      }),
    ).toBeInTheDocument();
  });
});
