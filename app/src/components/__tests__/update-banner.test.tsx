import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the @tauri-apps/plugin-updater module so the lib import doesn't try
// to resolve the real plugin (which requires the Tauri runtime).
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

const mockUpdater = vi.fn();
vi.mock("@/hooks/use-updater", () => ({
  useUpdater: () => mockUpdater(),
}));

import { UpdateBanner } from "@/components/update-banner";

const stubUpdate = {
  version: "v0.2.0",
  date: "2026-04-27",
  body: "release notes",
} as unknown as import("@tauri-apps/plugin-updater").Update;

describe("UpdateBanner", () => {
  beforeEach(() => {
    mockUpdater.mockReset();
  });

  it("renders nothing in idle state", () => {
    mockUpdater.mockReturnValue({
      update: null,
      status: "idle",
      error: null,
      relaunch: vi.fn(),
      dismiss: vi.fn(),
    });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while downloading", () => {
    mockUpdater.mockReturnValue({
      update: stubUpdate,
      status: "downloading",
      error: null,
      relaunch: vi.fn(),
      dismiss: vi.fn(),
    });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows version + buttons once a downloaded update is ready", () => {
    mockUpdater.mockReturnValue({
      update: stubUpdate,
      status: "ready",
      error: null,
      relaunch: vi.fn(),
      dismiss: vi.fn(),
    });
    render(<UpdateBanner />);
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Relaunch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Later/i })).toBeInTheDocument();
  });

  it("invokes relaunch when the user clicks Relaunch", () => {
    const relaunch = vi.fn();
    mockUpdater.mockReturnValue({
      update: stubUpdate,
      status: "ready",
      error: null,
      relaunch,
      dismiss: vi.fn(),
    });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Relaunch/i }));
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("invokes dismiss when the user clicks Later", () => {
    const dismiss = vi.fn();
    mockUpdater.mockReturnValue({
      update: stubUpdate,
      status: "ready",
      error: null,
      relaunch: vi.fn(),
      dismiss,
    });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Later/i }));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
