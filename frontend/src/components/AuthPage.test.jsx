import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AuthPage from "./AuthPage.jsx";

describe("AuthPage", () => {
  it("submits login credentials and prevents multiple submits while busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <AuthPage
        mode="login"
        error=""
        busy={false}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText("Email"), "reader@example.test");
    await user.type(screen.getByLabelText("Password"), "a secure password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith({
      email: "reader@example.test",
      password: "a secure password",
      displayName: "",
    });

    rerender(
      <AuthPage
        mode="login"
        error=""
        busy
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Please wait..." })
    ).toBeDisabled();
  });

  it("requires a valid registration form and provides a route to sign in", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onNavigate = vi.fn();
    render(
      <AuthPage
        mode="register"
        error="Registration is temporarily unavailable."
        busy={false}
        onSubmit={onSubmit}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Registration is temporarily unavailable."
    );
    expect(screen.getByLabelText(/Password/)).toHaveAttribute(
      "minLength",
      "12"
    );
    await user.type(screen.getByLabelText(/Display name/), "Diary Reader");
    await user.type(screen.getByLabelText("Email"), "reader@example.test");
    await user.type(screen.getByLabelText(/Password/), "long-enough-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(onSubmit).toHaveBeenCalledWith({
      email: "reader@example.test",
      password: "long-enough-password",
      displayName: "Diary Reader",
    });

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onNavigate).toHaveBeenCalledWith("/login");
  });
});
