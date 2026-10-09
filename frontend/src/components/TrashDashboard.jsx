import { useEffect, useState } from "react";
import {
  getTrashEntries,
  permanentlyDeleteTrashEntry,
  restoreTrashEntry,
} from "../api/entries.js";

function formatDeletedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Deletion date unavailable"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export default function TrashDashboard({ darkMode, revision, onMutation }) {
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyEntryId, setBusyEntryId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getTrashEntries({ page, limit: 10, search: appliedSearch })
      .then((response) => {
        if (!active) return;
        setEntries(response.data);
        setPagination(response.pagination);
        if (response.pagination.page !== page) {
          setPage(response.pagination.page);
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, appliedSearch, revision]);

  async function handleRestore(entry) {
    setBusyEntryId(entry._id);
    setError("");
    try {
      await restoreTrashEntry(entry._id);
      onMutation();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyEntryId("");
    }
  }

  async function handlePermanentDelete(entry) {
    if (
      !window.confirm(
        `Permanently delete "${entry.isLocked ? "Locked entry" : entry.title || "Untitled entry"}"? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyEntryId(entry._id);
    setError("");
    try {
      await permanentlyDeleteTrashEntry(entry._id);
      onMutation();
    } catch (requestError) {
      setError(requestError.message);
      try {
        const response = await getTrashEntries({
          page,
          limit: pagination.limit,
          search: appliedSearch,
        });
        setEntries(response.data);
        setPagination(response.pagination);
      } catch (refreshError) {
        setError(
          `${requestError.message}. Trash refresh failed: ${refreshError.message}`
        );
      }
    } finally {
      setBusyEntryId("");
    }
  }

  const panelClass = `rounded-2xl border ${
    darkMode ? "border-stone-800 bg-stone-900" : "border-stone-200 bg-white"
  }`;

  return (
    <section>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Recently deleted entries
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Trash
          </h1>
          <p className="mt-2 text-sm opacity-65">
            Restore an entry or permanently remove it and its attachments.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedSearch(search.trim());
          }}
        >
          <label>
            <span className="sr-only">Search trashed entries</span>
            <input
              className={`rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-600 ${
                darkMode
                  ? "border-stone-700 bg-stone-950"
                  : "border-stone-200 bg-white"
              }`}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Trash"
              value={search}
            />
          </label>
          <button
            className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-900"
            type="submit"
          >
            Search
          </button>
        </form>
      </header>

      {error && (
        <p
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          Trash could not be updated. {error}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm opacity-60">
          Loading trashed entries...
        </p>
      ) : error && !entries.length ? (
        <div
          className={`${panelClass} px-4 py-8 text-center text-sm text-red-700`}
        >
          Trashed entries could not be loaded. Check the error above and retry.
          <button
            className="ml-2 underline"
            onClick={() => onMutation()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className={`${panelClass} px-6 py-14 text-center`}>
          <h2 className="font-semibold">
            {appliedSearch ? "No trashed entries found" : "Trash is empty"}
          </h2>
          <p className="mt-2 text-sm opacity-60">
            {appliedSearch
              ? "Try another search term."
              : "Entries you move to Trash will appear here."}
          </p>
        </div>
      ) : (
        <>
          <ul
            className={`divide-y ${darkMode ? "divide-stone-800" : "divide-stone-200"}`}
          >
            {entries.map((entry) => (
              <li
                className={`${panelClass} mb-3 flex flex-wrap items-center gap-4 p-4`}
                key={entry._id}
              >
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">
                    {entry.isLocked
                      ? "🔒 Locked entry"
                      : entry.title || "Untitled entry"}
                  </h2>
                  <p className="mt-1 text-sm opacity-65">
                    {entry.date} · Deleted {formatDeletedAt(entry.deletedAt)}
                  </p>
                  {entry.purgeRequestedAt && (
                    <p className="mt-1 text-xs text-amber-700">
                      Permanent deletion is pending. Retry it to finish cleanup.
                    </p>
                  )}
                  {!entry.isLocked && entry.images?.length > 0 && (
                    <p className="mt-1 text-xs opacity-55">
                      {entry.images.length}{" "}
                      {entry.images.length === 1 ? "attachment" : "attachments"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                      darkMode ? "border-stone-700" : "border-stone-300"
                    }`}
                    disabled={
                      Boolean(busyEntryId) || Boolean(entry.purgeRequestedAt)
                    }
                    onClick={() => handleRestore(entry)}
                    type="button"
                  >
                    {busyEntryId === entry._id ? "Working..." : "Restore"}
                  </button>
                  <button
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                    disabled={Boolean(busyEntryId)}
                    onClick={() => handlePermanentDelete(entry)}
                    type="button"
                  >
                    {entry.purgeRequestedAt
                      ? "Retry permanent delete"
                      : "Permanently delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {pagination.totalPages > 1 && (
            <nav
              aria-label="Trash pages"
              className={`mt-5 flex items-center justify-between border-t pt-4 text-sm ${
                darkMode ? "border-stone-800" : "border-stone-200"
              }`}
            >
              <span className="opacity-65">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
                of {pagination.total}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
