import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";
import { act } from "react";

function TestToastTrigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast("Test message", "success")}>Show</button>;
}

describe("Toast", () => {
  it("renders toast message when triggered", async () => {
    render(
      <ToastProvider>
        <TestToastTrigger />
      </ToastProvider>
    );
    await act(async () => {
      screen.getByText("Show").click();
    });
    expect(screen.getByText("Test message")).toBeTruthy();
  });
});
