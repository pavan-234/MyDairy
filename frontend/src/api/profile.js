const profileUrl = "/api/profile";

async function request(path = "", options = {}) {
  const response = await fetch(`${profileUrl}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Profile API returned an unexpected response (${response.status}).`
    );
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("mydiary:unauthorized"));
    }
    const error = new Error(
      data.message || `Profile request failed (${response.status})`
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

export function getProfile() {
  return request();
}

export function updateProfile(profile) {
  return request("", { method: "PATCH", body: JSON.stringify(profile) });
}

export function changePassword(passwords) {
  return request("/password", {
    method: "POST",
    body: JSON.stringify(passwords),
  });
}

export function deleteAccount(confirmation) {
  return request("", {
    method: "DELETE",
    body: JSON.stringify(confirmation),
  });
}
