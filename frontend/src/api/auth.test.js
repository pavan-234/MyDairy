import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, login, logout, register } from "./auth.js";

function mockResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authentication API client", () => {
  it("uses same-origin credentials for session requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse(200, { user: { email: "reader@example.test" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentUser();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it.each([
    [
      "login",
      login,
      "/api/auth/login",
      { email: "reader@example.test", password: "passphrase" },
    ],
    [
      "registration",
      register,
      "/api/auth/register",
      {
        email: "reader@example.test",
        password: "passphrase",
        displayName: "Reader",
      },
    ],
  ])("sends %s credentials as JSON", async (_label, action, url, payload) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { user: { email: payload.email } }));
    vi.stubGlobal("fetch", fetchMock);

    await action(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("preserves server error status and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockResponse(401, { message: "Invalid email or password" })
        )
    );

    await expect(
      login({ email: "bad@example.test", password: "wrong" })
    ).rejects.toMatchObject({
      message: "Invalid email or password",
      status: 401,
    });
  });

  it("sends logout as a same-origin POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ credentials: "same-origin", method: "POST" })
    );
  });
});
