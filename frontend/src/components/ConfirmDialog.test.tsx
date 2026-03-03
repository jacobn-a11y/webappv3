import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="Test" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog when open", () => {
    render(
      <ConfirmDialog open={true} title="Delete item?" message="This cannot be undone." onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete item?")).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open={true} title="Test" message="msg" confirmLabel="Delete" onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open={true} title="Test" message="msg" onConfirm={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open={true} title="Test" message="msg" onConfirm={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
