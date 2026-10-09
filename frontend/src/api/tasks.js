const tasksUrl = "/api/tasks";

async function request(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(
      `Task API returned an unexpected response (${response.status}). Check that the backend is running.`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("mydiary:unauthorized"));
    }
    throw new Error(
      data.message || `Task request failed with status ${response.status}`
    );
  }

  return data;
}

export function getTasks(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return request(query ? `${tasksUrl}?${query}` : tasksUrl);
}

export function createTask(task) {
  return request(tasksUrl, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateTask(id, values) {
  return request(`${tasksUrl}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export function deleteTask(id) {
  return request(`${tasksUrl}/${id}`, {
    method: "DELETE",
  });
}
