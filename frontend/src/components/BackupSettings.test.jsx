import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BackupSettings from "./BackupSettings.jsx";
import { downloadBackup, importBackup, previewBackup } from "../api/backup.js";

vi.mock("../api/backup.js", () => ({
  downloadBackup: vi.fn(),
  importBackup: vi.fn(),
  previewBackup: vi.fn(),
}));

describe("BackupSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects an export format, reports progress and success, and handles failures", async () => {
    const user = userEvent.setup();
    downloadBackup.mockImplementation(
      async (_format, _includeTrash, progress) => {
        progress({ received: 2048, total: 4096 });
        return { filename: "mydiary-csv-export.zip", bytes: 2048 };
      }
    );
    render(<BackupSettings darkMode={false} />);

    await user.click(screen.getByRole("radio", { name: /CSV export/ }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "mydiary-csv-export.zip is ready (2.0 KB)."
    );
    expect(downloadBackup).toHaveBeenCalledWith(
      "csv",
      true,
      expect.any(Function),
      { includeLocked: false, currentPassword: "" }
    );

    downloadBackup.mockRejectedValueOnce(new Error("Export unavailable"));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Export unavailable"
    );
  });

  it("requires current-password verification to include locked entries in JSON backups", async () => {
    const user = userEvent.setup();
    downloadBackup.mockResolvedValue({
      filename: "mydiary-json-export.zip",
      bytes: 100,
    });
    render(<BackupSettings darkMode={false} />);

    await user.click(
      screen.getByRole("checkbox", {
        name: /Include locked entries in this backup/,
      })
    );
    await user.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your current password to include locked entries."
    );
    expect(downloadBackup).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Current password"), "test password");
    await user.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() =>
      expect(downloadBackup).toHaveBeenCalledWith(
        "json",
        true,
        expect.any(Function),
        { includeLocked: true, currentPassword: "test password" }
      )
    );
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("previews a backup and restores it only after confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    previewBackup.mockResolvedValue({
      backupId: "backup-1",
      alreadyImported: false,
      statistics: {
        entries: 2,
        trashedEntries: 1,
        tasks: 3,
        attachments: 1,
        archiveBytes: 1024,
      },
    });
    importBackup.mockResolvedValue({
      statistics: { entries: 2, tasks: 3, attachments: 1 },
    });
    render(<BackupSettings darkMode={false} />);

    const file = new File(["zip contents"], "backup.zip", {
      type: "application/zip",
    });
    await user.upload(
      screen.getByLabelText("Choose a MyDiary backup ZIP"),
      file
    );
    expect(
      await screen.findByRole("heading", { name: "Backup preview" })
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore backup" }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(importBackup).toHaveBeenCalledWith(file));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Restore complete: 2 entries, 3 tasks, and 1 attachment imported."
    );
  });

  it("does not restore an already imported backup and reports preview errors", async () => {
    const user = userEvent.setup();
    previewBackup.mockResolvedValueOnce({
      backupId: "backup-duplicate",
      alreadyImported: true,
      statistics: {
        entries: 1,
        trashedEntries: 0,
        tasks: 0,
        attachments: 0,
        archiveBytes: 50,
      },
    });
    render(<BackupSettings darkMode={false} />);

    const file = new File(["zip contents"], "duplicate.zip", {
      type: "application/zip",
    });
    await user.upload(
      screen.getByLabelText("Choose a MyDiary backup ZIP"),
      file
    );
    expect(
      await screen.findByText(
        "This backup has already been imported into your account."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore backup" })
    ).toBeDisabled();
    expect(importBackup).not.toHaveBeenCalled();

    previewBackup.mockRejectedValueOnce(new Error("Invalid backup"));
    await user.upload(
      screen.getByLabelText("Choose a MyDiary backup ZIP"),
      new File(["bad"], "invalid.zip", { type: "application/zip" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid backup"
    );
  });
});
