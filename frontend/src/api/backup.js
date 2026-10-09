const backupUrl = "/api/backup";

async function errorFromResponse(response) {
  const text = await response.text();
  try {
    const data = text ? JSON.parse(text) : {};
    return (
      data.message || `Backup request failed with status ${response.status}`
    );
  } catch {
    return `Backup request failed with status ${response.status}`;
  }
}

async function postBackup(path, file, confirmed = false) {
  const body = new FormData();
  body.append("backup", file, file.name);
  const response = await fetch(`${backupUrl}${path}`, {
    method: "POST",
    body,
    headers: confirmed ? { "X-Backup-Confirmed": "true" } : {},
  });
  if (!response.ok) {
    const message = await errorFromResponse(response);
    if (response.status === 401) {
      window.dispatchEvent(new Event("mydiary:unauthorized"));
    }
    throw new Error(message);
  }
  return response.json();
}

export function previewBackup(file) {
  return postBackup("/import/preview", file);
}

export function importBackup(file) {
  return postBackup("/import", file, true);
}

export async function downloadBackup(
  format,
  includeTrash,
  onProgress,
  { includeLocked = false, currentPassword = "" } = {}
) {
  const params = new URLSearchParams({
    format,
    includeTrash: String(includeTrash),
  });
  const response = includeLocked
    ? await fetch(`${backupUrl}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          includeTrash,
          includeLocked: true,
          currentPassword,
        }),
      })
    : await fetch(`${backupUrl}/export?${params}`);
  if (!response.ok) {
    const message = await errorFromResponse(response);
    if (response.status === 401) {
      window.dispatchEvent(new Event("mydiary:unauthorized"));
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error("The browser could not read the export stream");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const total = Number(response.headers.get("Content-Length")) || 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({ received, total });
  }

  const blob = new Blob(chunks, {
    type: response.headers.get("Content-Type") || "application/octet-stream",
  });
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename =
    disposition.match(/filename="([A-Za-z0-9._-]+)"/)?.[1] ||
    `mydiary-${format}-export.${format === "pdf" ? "pdf" : "zip"}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, bytes: received };
}
