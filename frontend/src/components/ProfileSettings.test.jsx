import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings.jsx";
import {
  changePassword,
  deleteAccount,
  getProfile,
  updateProfile,
} from "../api/profile.js";

vi.mock("../api/profile.js", () => ({
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("./BackupSettings.jsx", () => ({
  default: () => <div>Backup section</div>,
}));

const profile = {
  id: "user-1",
  displayName: "Diary User",
  email: "diary@example.test",
  createdAt: "2026-10-01T12:00:00.000Z",
  notificationPreferences: {
    browserNotifications: false,
    taskReminders: false,
  },
};

describe("ProfileSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProfile.mockResolvedValue({ profile });
    updateProfile.mockImplementation(async (updates) => ({
      profile: {
        ...profile,
        ...updates,
        notificationPreferences: {
          ...profile.notificationPreferences,
          ...updates.notificationPreferences,
        },
      },
    }));
  });

  it("loads and updates the profile, persists notification preferences, and selects the theme", async () => {
    const user = userEvent.setup();
    const onProfileUpdate = vi.fn();
    const onThemeChange = vi.fn();
    render(
      <ProfileSettings
        user={profile}
        darkMode={false}
        themePreference="light"
        onThemeChange={onThemeChange}
        onProfileUpdate={onProfileUpdate}
        onLogout={vi.fn()}
        onAccountDeleted={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(await screen.findByDisplayValue("Diary User")).toBeInTheDocument();
    expect(screen.getByText("diary@example.test")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "New Name");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ displayName: "New Name" })
    );
    expect(onProfileUpdate).toHaveBeenCalled();

    await user.click(
      screen.getByLabelText("Task reminder preference (delivery unavailable)")
    );
    await user.click(
      screen.getByRole("button", { name: "Save notification preferences" })
    );
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        notificationPreferences: {
          browserNotifications: false,
          taskReminders: true,
        },
      })
    );

    await user.click(
      screen.getByRole("radio", { name: "Use system preference" })
    );
    expect(onThemeChange).toHaveBeenCalledWith("system");
  });

  it("validates and submits secure password changes", async () => {
    const user = userEvent.setup();
    changePassword.mockResolvedValue({
      message: "Password changed successfully",
    });
    render(
      <ProfileSettings
        user={profile}
        darkMode={false}
        themePreference="light"
        onThemeChange={vi.fn()}
        onProfileUpdate={vi.fn()}
        onLogout={vi.fn()}
        onAccountDeleted={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("Current password", {
        selector: "#current-password",
      }),
      "old secure password"
    );
    await user.type(
      screen.getByLabelText("New password"),
      "new secure password"
    );
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "different password"
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "New passwords do not match."
    );
    expect(changePassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new secure password"
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "old secure password",
        newPassword: "new secure password",
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password changed successfully"
    );
  });

  it("requires typed and modal confirmation before account deletion", async () => {
    const user = userEvent.setup();
    const onAccountDeleted = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteAccount.mockResolvedValue({ message: "Account deleted" });
    render(
      <ProfileSettings
        user={profile}
        darkMode={false}
        themePreference="light"
        onThemeChange={vi.fn()}
        onProfileUpdate={vi.fn()}
        onLogout={vi.fn()}
        onAccountDeleted={onAccountDeleted}
        onNavigate={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("Current password", {
        selector: "#delete-password",
      }),
      "old secure password"
    );
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Permanently delete account" })
    );
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith({
        currentPassword: "old secure password",
        confirmation: "DELETE",
      })
    );
    expect(onAccountDeleted).toHaveBeenCalledTimes(1);
  });
});
