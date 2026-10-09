import { useState } from "react";
import { downloadBackup, importBackup, previewBackup } from "../api/backup.js";

const formats = [
  {
    id: "json",
    label: "JSON backup",
    detail: "Restorable ZIP with entries, tasks, and images.",
  },
  {
    id: "csv",
    label: "CSV export",
    detail: "Spreadsheet-ready entries and tasks in a ZIP.",
  },
  {
    id: "pdf",
    label: "PDF export",
    detail: "A readable, printable diary and task report.",
  },
];

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupSettings({ darkMode }) {
  const [format, setFormat] = useState("json");
  const [includeTrash, setIncludeTrash] = useState(true);
  const [includeLocked, setIncludeLocked] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [backupFile, setBackupFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fieldClass = `rounded-lg border px-3 py-2 text-sm ${
    darkMode
      ? "border-stone-700 bg-stone-950 text-stone-100"
      : "border-stone-200 bg-white text-stone-800"
  }`;
  const panelClass = `rounded-2xl border p-5 sm:p-6 ${
    darkMode ? "border-stone-800 bg-stone-900" : "border-stone-200 bg-white"
  }`;

  async function handleExport() {
    const shouldIncludeLocked = format === "json" && includeLocked;
    if (shouldIncludeLocked && !currentPassword) {
      setError("Enter your current password to include locked entries.");
      return;
    }
    setExporting(true);
    setError("");
    setNotice("");
    setExportProgress({ received: 0, total: 0 });
    try {
      const result = await downloadBackup(
        format,
        includeTrash,
        setExportProgress,
        { includeLocked: shouldIncludeLocked, currentPassword }
      );
      setNotice(`${result.filename} is ready (${formatBytes(result.bytes)}).`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting(false);
      setExportProgress(null);
      setCurrentPassword("");
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    setBackupFile(file);
    setPreview(null);
    setNotice("");
    setError("");
    if (!file) return;
    setPreviewLoading(true);
    try {
      const result = await previewBackup(file);
      setPreview(result);
    } catch (requestError) {
      setError(requestError.message);
      setBackupFile(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestore() {
    if (
      !backupFile ||
      !preview ||
      preview.alreadyImported ||
      !window.confirm(
        `Restore ${preview.statistics.entries} entries and ${preview.statistics.tasks} tasks into your current account? This adds data and does not overwrite existing items.`
      )
    ) {
      return;
    }
    setRestoring(true);
    setError("");
    setNotice("");
    try {
      const result = await importBackup(backupFile);
      setNotice(
        `Restore complete: ${result.statistics.entries} entries, ${result.statistics.tasks} tasks, and ${result.statistics.attachments} attachment${result.statistics.attachments === 1 ? "" : "s"} imported.`
      );
      setBackupFile(null);
      setPreview(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section>
      <header className="mb-7">
        <p className="text-sm font-medium text-emerald-700">
          Your data, portable and private
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Export &amp; Backup
        </h1>
        <p className="mt-2 text-sm opacity-65">
          Exports contain only data belonging to your account.
        </p>
      </header>

      {error && (
        <p
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          role="status"
        >
          {notice}
        </p>
      )}

      <div className="space-y-5">
        <section className={panelClass}>
          <h2 className="text-lg font-semibold">Export your data</h2>
          <p className="mt-1 text-sm opacity-65">
            JSON ZIP is the restorable backup format. CSV and PDF are for
            spreadsheets and printing.
          </p>
          <fieldset className="mt-5 space-y-3">
            <legend className="sr-only">Export format</legend>
            {formats.map((item) => (
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                  format === item.id
                    ? "border-emerald-600 bg-emerald-50/60"
                    : darkMode
                      ? "border-stone-800"
                      : "border-stone-200"
                }`}
                key={item.id}
              >
                <input
                  checked={format === item.id}
                  className="mt-1 accent-emerald-700"
                  name="backup-format"
                  onChange={() => setFormat(item.id)}
                  type="radio"
                  value={item.id}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs opacity-65">
                    {item.detail}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              checked={includeTrash}
              className="accent-emerald-700"
              onChange={(event) => setIncludeTrash(event.target.checked)}
              type="checkbox"
            />
            Include trashed entries
          </label>
          {format === "json" && (
            <>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  checked={includeLocked}
                  className="mt-1 accent-emerald-700"
                  onChange={(event) => setIncludeLocked(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Include locked entries in this backup
                  <span className="mt-1 block text-xs opacity-60">
                    Locked entry content is included in the downloaded file.
                    Your current password is required.
                  </span>
                </span>
              </label>
              {includeLocked && (
                <label className="mt-3 block text-sm font-medium">
                  Current password
                  <input
                    autoComplete="current-password"
                    className={`mt-1 block w-full max-w-md ${fieldClass}`}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    type="password"
                    value={currentPassword}
                  />
                </label>
              )}
            </>
          )}
          <button
            className="mt-5 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={exporting}
            onClick={handleExport}
            type="button"
          >
            {exporting
              ? "Preparing export..."
              : `Export ${format.toUpperCase()}`}
          </button>
          {exporting && (
            <p aria-live="polite" className="mt-3 text-sm opacity-65">
              {exportProgress?.received
                ? `Receiving ${formatBytes(exportProgress.received)}...`
                : "Preparing a secure download..."}
            </p>
          )}
        </section>

        <section className={panelClass}>
          <h2 className="text-lg font-semibold">Restore a JSON backup</h2>
          <p className="mt-1 text-sm opacity-65">
            Restore adds records to your signed-in account. It does not replace
            existing entries, tasks, or profile information.
          </p>
          <label className="mt-4 block text-sm font-medium">
            Choose a MyDiary backup ZIP
            <input
              accept=".zip,application/zip"
              className={`mt-2 block w-full ${fieldClass}`}
              disabled={previewLoading || restoring}
              onChange={handleFileChange}
              type="file"
            />
          </label>
          {previewLoading && (
            <p aria-live="polite" className="mt-3 text-sm opacity-65">
              Validating backup and checking attachments...
            </p>
          )}
          {preview && (
            <div
              className={`mt-4 rounded-xl border p-4 ${
                darkMode
                  ? "border-stone-800 bg-stone-950"
                  : "border-stone-200 bg-stone-50"
              }`}
            >
              <h3 className="font-medium">Backup preview</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="opacity-60">Entries</dt>
                  <dd className="font-medium">{preview.statistics.entries}</dd>
                </div>
                <div>
                  <dt className="opacity-60">In Trash</dt>
                  <dd className="font-medium">
                    {preview.statistics.trashedEntries}
                  </dd>
                </div>
                <div>
                  <dt className="opacity-60">Tasks</dt>
                  <dd className="font-medium">{preview.statistics.tasks}</dd>
                </div>
                <div>
                  <dt className="opacity-60">Attachments</dt>
                  <dd className="font-medium">
                    {preview.statistics.attachments}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs opacity-60">
                Archive contains {formatBytes(preview.statistics.archiveBytes)}.
                Imported data will belong to your current account.
              </p>
              {preview.alreadyImported && (
                <p className="mt-3 text-sm text-amber-800" role="alert">
                  This backup has already been imported into your account.
                </p>
              )}
              <button
                className="mt-4 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={restoring || preview.alreadyImported}
                onClick={handleRestore}
                type="button"
              >
                {restoring ? "Restoring backup..." : "Restore backup"}
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
