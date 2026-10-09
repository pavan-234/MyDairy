const entriesUrl = "/api/entries";

async function request(url, options) {
  const headers = { ...options?.headers };
  if (
    options?.body &&
    !(options.body instanceof FormData) &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(
      `Diary API returned an unexpected response (${response.status}). Check that the backend is running.`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("mydiary:unauthorized"));
    }
    throw new Error(
      data.message || `Diary request failed with status ${response.status}`
    );
  }

  return data;
}

export function getEntries(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return request(query ? `${entriesUrl}?${query}` : entriesUrl);
}

export function getCalendarDates(from, to) {
  const params = new URLSearchParams({ from, to });
  return request(`${entriesUrl}/calendar/dates?${params}`);
}

export function getCalendarActivity(from, to) {
  const params = new URLSearchParams({ from, to });
  return request(`${entriesUrl}/calendar/activity?${params}`);
}

export function getCalendarDay(date, page = 1, limit = 50) {
  const params = new URLSearchParams({
    date,
    page: String(page),
    limit: String(limit),
  });
  return request(`${entriesUrl}/calendar/day?${params}`);
}

export function getStreak(today) {
  const params = new URLSearchParams({ today });
  return request(`${entriesUrl}/streak?${params}`);
}

export function getDashboard(today, group = "day") {
  const params = new URLSearchParams({ today, group });
  return request(`/api/dashboard?${params}`);
}

export function getEntry(id) {
  return request(`${entriesUrl}/${id}`);
}

export function lockEntry(id) {
  return request(`${entriesUrl}/${id}/lock`, { method: "POST" });
}

export function unlockEntry(id, currentPassword) {
  return request(`${entriesUrl}/${id}/unlock`, {
    method: "POST",
    body: JSON.stringify({ currentPassword }),
  });
}

export function createEntry(entry) {
  return request(entriesUrl, {
    method: "POST",
    headers: {
      "X-Timezone-Offset": String(new Date().getTimezoneOffset()),
    },
    body: JSON.stringify(entry),
  });
}

export function updateEntry(id, entry) {
  return request(`${entriesUrl}/${id}`, {
    method: "PUT",
    body: JSON.stringify(entry),
  });
}

export function deleteEntry(id) {
  return request(`${entriesUrl}/${id}`, {
    method: "DELETE",
  });
}

export function getTrashEntries(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return request(`${entriesUrl}/trash${query ? `?${query}` : ""}`);
}

export function restoreTrashEntry(id) {
  return request(`${entriesUrl}/trash/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteTrashEntry(id) {
  return request(`${entriesUrl}/trash/${id}`, { method: "DELETE" });
}

export function uploadEntryImage(entryId, file) {
  const body = new FormData();
  body.append("image", file);
  return request(`${entriesUrl}/${entryId}/images`, {
    method: "POST",
    body,
  });
}

export function deleteEntryImage(entryId, imageId) {
  return request(`${entriesUrl}/${entryId}/images/${imageId}`, {
    method: "DELETE",
  });
}
