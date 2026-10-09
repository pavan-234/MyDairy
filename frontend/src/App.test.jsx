import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { getCurrentUser } from "./api/auth.js";

vi.mock("./api/auth.js", () => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}));

describe("authentication routing", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.removeItem("mydiary-theme");
    getCurrentUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 })
    );
  });

  it("shows the public home page and routes to login when a session expires", async () => {
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Start your journal" })
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/"));

    window.dispatchEvent(new Event("mydiary:unauthorized"));

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Please sign in again."
    );
    expect(window.location.pathname).toBe("/login");
  });

  it("persists light and dark selections and follows system theme changes", async () => {
    const user = userEvent.setup();
    let handleSystemChange;
    const media = {
      matches: true,
      addEventListener: (_event, listener) => {
        handleSystemChange = listener;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media)
    );
    const { unmount } = render(<App />);
    await screen.findByRole("button", { name: "Start your journal" });
    await user.click(
      screen.getByRole("button", { name: "Switch to dark theme" })
    );
    await waitFor(() =>
      expect(window.localStorage.getItem("mydiary-theme")).toBe("dark")
    );
    unmount();
    window.localStorage.setItem("mydiary-theme", "system");
    render(<App />);
    await screen.findByRole("button", { name: "Start your journal" });
    expect(screen.getByRole("main").className).toContain("bg-[#101713]");
    media.matches = false;
    act(() => handleSystemChange());
    expect(screen.getByRole("main").className).toContain("bg-[#f7f7f2]");
    vi.unstubAllGlobals();
  });
});
