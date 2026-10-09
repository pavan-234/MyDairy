const authUrl = "/api/auth";

async function request(path, options = {}) {
  const response = await fetch(`${authUrl}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(
      `Authentication API returned an unexpected response (${response.status}).`
    );
  }

  if (!response.ok) {
    const error = new Error(
      data.message || `Authentication failed (${response.status})`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

export function getCurrentUser() {
  return request("/me");
}

export function login(credentials) {
  return request("/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function register(details) {
  return request("/register", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export function logout() {
  return request("/logout", { method: "POST" });
}
