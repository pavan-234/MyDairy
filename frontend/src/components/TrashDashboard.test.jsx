import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TrashDashboard from "./TrashDashboard.jsx";
import {
  getTrashEntries,
  permanentlyDeleteTrashEntry,
  restoreTrashEntry,
} from "../api/entries.js";

vi.mock("../api/entries.js", () => ({
  getTrashEntries: vi.fn(),
  permanentlyDeleteTrashEntry: vi.fn(),
  restoreTrashEntry: vi.fn(),
}));

const trashedEntry = {
  _id: "entry-1",
  title: "A private memory",
  date: "2026-10-08",
  deletedAt: "2026-10-08T09:00:00.000Z",
  images: [{ id: "image-1" }],
};

describe("TrashDashboard", () => {
  beforeEach(() => {
    getTrashEntries.mockResolvedValue({
      data: [trashedEntry],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("loads trashed entries and supports restore and confirmed permanent deletion", async () => {
    const user = userEvent.setup();
    const onMutation = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <TrashDashboard darkMode={false} revision={0} onMutation={onMutation} />
    );

    expect(await screen.findByText("A private memory")).toBeInTheDocument();
    expect(screen.getByText(/1 attachment/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(restoreTrashEntry).toHaveBeenCalledWith("entry-1")
    );
    expect(onMutation).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Permanently delete" })
    );
    expect(confirm).toHaveBeenCalledWith(
      'Permanently delete "A private memory"? This cannot be undone.'
    );
    await waitFor(() =>
      expect(permanentlyDeleteTrashEntry).toHaveBeenCalledWith("entry-1")
    );
    expect(onMutation).toHaveBeenCalledTimes(2);
  });

  it("shows empty and API error states", async () => {
    const { rerender } = render(
      <TrashDashboard darkMode={false} revision={0} onMutation={vi.fn()} />
    );
    expect(await screen.findByText("A private memory")).toBeInTheDocument();

    getTrashEntries.mockResolvedValueOnce({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    rerender(
      <TrashDashboard darkMode={false} revision={1} onMutation={vi.fn()} />
    );
    expect(await screen.findByText("Trash is empty")).toBeInTheDocument();

    getTrashEntries.mockRejectedValueOnce(new Error("Service unavailable"));
    rerender(
      <TrashDashboard darkMode={false} revision={2} onMutation={vi.fn()} />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Service unavailable"
    );
    expect(
      await screen.findByText(/Trashed entries could not be loaded/)
    ).toBeInTheDocument();
  });
});
