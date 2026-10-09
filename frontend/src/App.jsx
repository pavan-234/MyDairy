import { useCallback, useEffect, useRef, useState } from "react";
import AuthPage from "./components/AuthPage.jsx";
import Dashboard from "./components/Dashboard.jsx";
import HomePage from "./components/HomePage.jsx";
import ProfileSettings from "./components/ProfileSettings.jsx";
import TrashDashboard from "./components/TrashDashboard.jsx";
import { getCurrentUser, login, logout, register } from "./api/auth.js";
import {
  createEntry,
  deleteEntry,
  getCalendarActivity,
  getCalendarDay,
  getEntries,
  getEntry,
  getStreak,
  lockEntry,
  deleteEntryImage,
  uploadEntryImage,
  unlockEntry,
  updateEntry,
} from "./api/entries.js";
import { createTask, deleteTask, getTasks, updateTask } from "./api/tasks.js";
import { localDateKey, localMonthDateRange } from "./utils/date.js";

const fontFamilies = ["Arial", "Georgia", "Times New Roman", "Courier New"];
const sizePresets = [
  { label: "Small", size: 14 },
  { label: "Medium", size: 18 },
  { label: "Large", size: 24 },
];
const pageStyles = [
  { value: "plain", label: "Plain white" },
  { value: "ruled", label: "Ruled paper" },
  { value: "dotted", label: "Dotted paper" },
  { value: "dark", label: "Dark paper" },
];
const moodOptions = [
  { value: "HAPPY", label: "Happy", emoji: "😊" },
  { value: "GOOD", label: "Good", emoji: "🙂" },
  { value: "NEUTRAL", label: "Neutral", emoji: "😐" },
  { value: "SAD", label: "Sad", emoji: "😢" },
  { value: "ANGRY", label: "Angry", emoji: "😠" },
  { value: "EXCITED", label: "Excited", emoji: "🤩" },
];
const maxEntryImages = 5;
const maxImageSize = 5 * 1024 * 1024;
const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"];
const entryUnlockTimeoutMs = 5 * 60 * 1000 - 1000;
const initialEntryQuery = {
  page: 1,
  limit: 10,
  search: "",
  mood: "",
  tags: "",
  favorite: "",
  from: "",
  to: "",
  sort: "createdAt",
  order: "desc",
};

function defaultFormatting(theme = "light") {
  return {
    fontFamily: "Georgia",
    fontSize: 18,
    textColor: "#292524",
    textAlign: "left",
    pageStyle: "plain",
    theme,
  };
}

function todayAsInputValue() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function emptyForm(theme = "light") {
  return {
    title: "",
    content: "",
    date: todayAsInputValue(),
    formatting: defaultFormatting(theme),
    mood: "NEUTRAL",
    tagsText: "",
    isFavorite: false,
    isDraft: false,
  };
}

function savedFormatting(entry) {
  return { ...defaultFormatting(), ...entry.formatting };
}

function formatDate(date) {
  return new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString(
    undefined,
    { year: "numeric", month: "long", day: "numeric" }
  );
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function entryFormValues(entry) {
  return {
    title: entry.title || "",
    content: sanitizeDiaryHtml(entry.content || ""),
    date: entry.date.slice(0, 10),
    formatting: savedFormatting(entry),
    mood: entry.mood || "NEUTRAL",
    tagsText: (entry.tags || []).join(", "),
    isFavorite: Boolean(entry.isFavorite),
    isDraft: Boolean(entry.isDraft),
  };
}

function formatMonth(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function sanitizeDiaryHtml(html = "") {
  const parsed = new DOMParser().parseFromString(String(html), "text/html");
  const clean = document.createElement("div");
  const allowedTags = new Set([
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "BR",
    "P",
    "DIV",
    "SPAN",
    "FONT",
  ]);

  function copySafeNode(source, parent) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(source.textContent || ""));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = source.tagName.toUpperCase();
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(tag)) {
      return;
    }
    if (!allowedTags.has(tag)) {
      for (const child of source.childNodes) {
        copySafeNode(child, parent);
      }
      return;
    }

    const outputTag = tag === "FONT" ? "SPAN" : tag.toLowerCase();
    const element = document.createElement(outputTag);
    const color =
      tag === "FONT" ? source.getAttribute("color") : source.style.color;

    if (
      color &&
      (/^#[\da-f]{3,8}$/i.test(color) || /^rgba?\([\d\s.,%]+\)$/i.test(color))
    ) {
      element.style.color = color;
    }

    for (const child of source.childNodes) {
      copySafeNode(child, element);
    }
    parent.appendChild(element);
  }

  for (const child of parsed.body.childNodes) {
    copySafeNode(child, clean);
  }
  return clean.innerHTML;
}

function pageStyleClass(pageStyle) {
  if (pageStyle === "ruled") return "paper-ruled";
  if (pageStyle === "dotted") return "paper-dotted";
  if (pageStyle === "dark") return "paper-dark";
  return "paper-plain";
}

function textPreview(content = "") {
  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diaryTextContent(html = "") {
  const formattedHtml = sanitizeDiaryHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n");
  const parsed = new DOMParser().parseFromString(formattedHtml, "text/html");

  return (parsed.body.textContent || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function moodPresentation(mood) {
  return moodOptions.find((option) => option.value === mood) || moodOptions[2];
}

function EntryReader({ entry, darkMode }) {
  const formatting = savedFormatting(entry);
  const mood = moodPresentation(entry.mood);
  const editorTextColor =
    formatting.pageStyle === "dark" &&
    formatting.textColor.toLowerCase() === "#292524"
      ? "#f5f5f4"
      : formatting.textColor;

  return (
    <article>
      <header
        className={`border-b px-5 py-5 sm:px-8 ${
          darkMode ? "border-stone-800" : "border-stone-100"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {entry.isLocked && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
              🔒 Private entry
            </span>
          )}
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-900">
            {mood.emoji} {mood.label}
          </span>
          {entry.isDraft && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
              Draft
            </span>
          )}
          {entry.isFavorite && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
              ★ Favorite
            </span>
          )}
          {(entry.tags || []).map((tag) => (
            <span
              className={`rounded-full px-3 py-1 ${
                darkMode
                  ? "bg-stone-800 text-stone-300"
                  : "bg-stone-100 text-stone-600"
              }`}
              key={tag}
            >
              #{tag}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm font-medium text-emerald-800">
          {formatDate(entry.date)}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-55">
          <span>Created {formatTimestamp(entry.createdAt)}</span>
          <span>Updated {formatTimestamp(entry.updatedAt)}</span>
        </div>
      </header>
      <div
        className={`min-h-[360px] px-5 py-7 leading-8 sm:min-h-[440px] sm:px-8 ${pageStyleClass(
          formatting.pageStyle
        )}`}
        style={{
          fontFamily: formatting.fontFamily,
          fontSize: `${formatting.fontSize}px`,
          color: editorTextColor,
          textAlign: formatting.textAlign,
        }}
        dangerouslySetInnerHTML={{
          __html: sanitizeDiaryHtml(entry.content || ""),
        }}
      />
      {entry.images?.length > 0 && (
        <section
          aria-label="Attached images"
          className={`grid gap-3 border-t p-5 sm:grid-cols-2 sm:p-8 ${
            darkMode ? "border-stone-800" : "border-stone-100"
          }`}
        >
          {entry.images.map((image) => (
            <figure className="overflow-hidden rounded-xl" key={image.id}>
              <img
                alt={image.originalName}
                className="max-h-[32rem] w-full rounded-xl object-contain"
                loading="lazy"
                src={`/api/entries/${entry._id}/images/${image.id}`}
              />
              <figcaption className="mt-1 truncate text-xs opacity-60">
                {image.originalName}
              </figcaption>
            </figure>
          ))}
        </section>
      )}
    </article>
  );
}

export function LockedEntryPrompt({
  entry,
  darkMode,
  loading,
  error,
  onUnlock,
}) {
  const [password, setPassword] = useState("");

  return (
    <section className="mx-auto max-w-md px-6 py-12 text-center">
      <div aria-hidden="true" className="text-4xl">
        🔒
      </div>
      <h2 className="mt-3 text-xl font-semibold">This entry is locked</h2>
      <p className="mt-2 text-sm opacity-65">
        Entry from {formatDate(entry.date)}. Verify your account password to
        view its contents.
      </p>
      <form
        className="mt-6 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          onUnlock(password);
          setPassword("");
        }}
      >
        <label className="block text-sm font-medium">
          Current password
          <input
            autoComplete="current-password"
            className={`mt-1 block w-full rounded-lg border px-3 py-2 ${
              darkMode
                ? "border-stone-700 bg-stone-950"
                : "border-stone-300 bg-white"
            }`}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button
          className="mt-4 w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={loading || !password}
          type="submit"
        >
          {loading ? "Verifying..." : "Unlock entry"}
        </button>
      </form>
    </section>
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [pathname, setPathname] = useState(window.location.pathname);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [themePreference, setThemePreference] = useState(() => {
    const savedPreference = window.localStorage.getItem("mydiary-theme");
    return ["light", "dark", "system"].includes(savedPreference)
      ? savedPreference
      : "light";
  });
  const [systemDarkMode, setSystemDarkMode] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );
  const publicDarkMode =
    themePreference === "system" ? systemDarkMode : themePreference === "dark";

  useEffect(() => {
    window.localStorage.setItem("mydiary-theme", themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDarkMode(media.matches);
    updateSystemTheme();
    if (media.addEventListener) {
      media.addEventListener("change", updateSystemTheme);
      return () => media.removeEventListener("change", updateSystemTheme);
    }
    media.addListener(updateSystemTheme);
    return () => media.removeListener(updateSystemTheme);
  }, []);

  function toggleExplicitTheme() {
    setThemePreference(publicDarkMode ? "light" : "dark");
  }

  function navigate(path, replace = false) {
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
    setPathname(path);
  }

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener("popstate", handlePopState);

    let active = true;
    getCurrentUser()
      .then(({ user: currentUser }) => {
        if (!active) return;
        setUser(currentUser);
        setAuthStatus("ready");
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.status === 401) {
          setUser(null);
          setAuthStatus("ready");
        } else {
          setAuthError(requestError.message);
          setAuthStatus("error");
        }
      });

    function handleUnauthorized() {
      setUser(null);
      setAuthStatus("ready");
      setAuthError("Your session expired. Please sign in again.");
      navigate("/login", true);
    }
    window.addEventListener("mydiary:unauthorized", handleUnauthorized);

    return () => {
      active = false;
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("mydiary:unauthorized", handleUnauthorized);
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (
      !user &&
      pathname !== "/" &&
      pathname !== "/login" &&
      pathname !== "/register"
    ) {
      navigate("/", true);
    } else if (user && (pathname === "/login" || pathname === "/register")) {
      navigate("/", true);
    }
  }, [authStatus, pathname, user]);

  async function handleAuthSubmit(credentials) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const response =
        pathname === "/register"
          ? await register(credentials)
          : await login(credentials);
      setUser(response.user);
      setAuthStatus("ready");
      navigate("/", true);
    } catch (requestError) {
      setAuthError(requestError.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setAuthError("");
    setAuthStatus("ready");
    navigate("/", true);
  }

  if (authStatus === "loading") {
    return (
      <HomePage
        darkMode={publicDarkMode}
        onNavigate={(path) => navigate(path)}
        onToggleTheme={toggleExplicitTheme}
      />
    );
  }

  if (authStatus === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f5f1] px-4 text-center">
        <section>
          <h1 className="text-xl font-semibold text-stone-800">
            Unable to connect
          </h1>
          <p className="mt-2 text-sm text-stone-600" role="alert">
            {authError}
          </p>
          <button
            className="mt-5 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              setAuthError("");
              setAuthStatus("loading");
              setLoadAttempt((attempt) => attempt + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    if (pathname !== "/login" && pathname !== "/register") {
      return (
        <HomePage
          darkMode={publicDarkMode}
          onNavigate={(path) => navigate(path)}
          onToggleTheme={toggleExplicitTheme}
        />
      );
    }

    return (
      <AuthPage
        busy={authBusy}
        darkMode={publicDarkMode}
        error={authError}
        mode={pathname === "/register" ? "register" : "login"}
        onNavigate={(path) => {
          setAuthError("");
          navigate(path);
        }}
        onSubmit={handleAuthSubmit}
        onToggleTheme={toggleExplicitTheme}
      />
    );
  }

  function handleAccountDeleted() {
    setUser(null);
    setAuthError("");
    setAuthStatus("ready");
    navigate("/", true);
  }

  return (
    <DiaryApp
      key={user.id}
      user={user}
      onLogout={handleLogout}
      onAccountDeleted={handleAccountDeleted}
      darkMode={publicDarkMode}
      themePreference={themePreference}
      onThemeChange={setThemePreference}
      onProfileUpdate={(profile) =>
        setUser((current) => ({
          ...current,
          displayName: profile.displayName,
        }))
      }
    />
  );
}

function DiaryApp({
  user,
  onLogout,
  onAccountDeleted,
  darkMode,
  themePreference,
  onThemeChange,
  onProfileUpdate,
}) {
  const [entries, setEntries] = useState([]);
  const [entryPagination, setEntryPagination] = useState({
    page: 1,
    limit: initialEntryQuery.limit,
    total: 0,
    totalPages: 0,
  });
  const [entryQuery, setEntryQuery] = useState(initialEntryQuery);
  const [entryRevision, setEntryRevision] = useState(0);
  const [calendarActivity, setCalendarActivity] = useState([]);
  const [calendarEntries, setCalendarEntries] = useState([]);
  const [calendarActivityLoading, setCalendarActivityLoading] = useState(false);
  const [calendarDayLoading, setCalendarDayLoading] = useState(false);
  const [calendarActivityError, setCalendarActivityError] = useState("");
  const [calendarDayError, setCalendarDayError] = useState("");
  const [calendarDayPage, setCalendarDayPage] = useState(1);
  const [calendarDayPagination, setCalendarDayPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [streak, setStreak] = useState({
    current: 0,
    longest: 0,
    writtenToday: false,
  });
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [lockedEntryPreview, setLockedEntryPreview] = useState(null);
  const [entryUnlocked, setEntryUnlocked] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const unlockTimerRef = useRef(null);
  const [form, setForm] = useState(() => emptyForm());
  const [pendingImages, setPendingImages] = useState([]);
  const [removedImageIds, setRemovedImageIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [isEditing, setIsEditing] = useState(true);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [currentPage, setCurrentPage] = useState("diary");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [calendarDate, setCalendarDate] = useState(todayAsInputValue());
  const [tasks, setTasks] = useState([]);
  const [todayTasks, setTodayTasks] = useState([]);
  const [taskPagination, setTaskPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [taskQuery, setTaskQuery] = useState({
    page: 1,
    limit: 50,
    status: "",
    priority: "",
    from: "",
    to: "",
    search: "",
  });
  const [taskRevision, setTaskRevision] = useState(0);
  const [taskText, setTaskText] = useState("");
  const [sidebarTaskText, setSidebarTaskText] = useState("");
  const [taskDate, setTaskDate] = useState(todayAsInputValue);
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [taskRecurrence, setTaskRecurrence] = useState("NONE");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [taskError, setTaskError] = useState("");
  const today = todayAsInputValue();

  const clearUnlockTimer = useCallback(() => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!entryUnlocked || !lockedEntryPreview) return undefined;
    unlockTimerRef.current = window.setTimeout(() => {
      unlockTimerRef.current = null;
      setEntryUnlocked(false);
      setSelectedEntry(lockedEntryPreview);
      setForm(emptyForm(darkMode ? "dark" : "light"));
      setIsEditing(false);
      setUnlockError("The unlock session expired. Verify your password again.");
    }, entryUnlockTimeoutMs);
    return clearUnlockTimer;
  }, [clearUnlockTimer, darkMode, entryUnlocked, lockedEntryPreview]);

  useEffect(() => {
    if (currentPage === "diary" || !entryUnlocked) return;
    clearUnlockTimer();
    setEntryUnlocked(false);
    setSelectedEntry(lockedEntryPreview);
    setForm(emptyForm(darkMode ? "dark" : "light"));
    setIsEditing(false);
  }, [
    clearUnlockTimer,
    currentPage,
    darkMode,
    entryUnlocked,
    lockedEntryPreview,
  ]);

  useEffect(() => {
    if (!entryUnlocked || !lockedEntryPreview) return undefined;
    function lockWhenHidden() {
      if (document.visibilityState !== "hidden") return;
      clearUnlockTimer();
      setEntryUnlocked(false);
      setSelectedEntry(lockedEntryPreview);
      setForm(emptyForm(darkMode ? "dark" : "light"));
      setIsEditing(false);
    }
    document.addEventListener("visibilitychange", lockWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", lockWhenHidden);
  }, [clearUnlockTimer, darkMode, entryUnlocked, lockedEntryPreview]);

  async function handleLogout() {
    setLoggingOut(true);
    setError("");
    clearUnlockTimer();
    setEntryUnlocked(false);
    setSelectedEntry(null);
    setLockedEntryPreview(null);
    setForm(emptyForm(darkMode ? "dark" : "light"));
    try {
      await onLogout();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadEntries() {
      setLoading(true);
      try {
        const response = await getEntries(entryQuery);
        if (!active) return;
        setEntries(response.data);
        setEntryPagination(response.pagination);
        if (response.pagination.page !== entryQuery.page) {
          setEntryQuery((current) => ({
            ...current,
            page: response.pagination.page,
          }));
        }
        setError("");
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadEntries();
    return () => {
      active = false;
    };
  }, [entryQuery, entryRevision]);

  useEffect(() => {
    const { from: monthStart, to: monthEnd } = localMonthDateRange(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth()
    );
    let active = true;

    async function loadCalendarActivity() {
      setCalendarActivityLoading(true);
      setCalendarActivityError("");
      try {
        const activityResponse = await getCalendarActivity(
          monthStart,
          monthEnd
        );
        if (!active) return;
        setCalendarActivity(activityResponse.data);
      } catch (requestError) {
        if (active) setCalendarActivityError(requestError.message);
      } finally {
        if (active) setCalendarActivityLoading(false);
      }
    }

    if (currentPage === "calendar") loadCalendarActivity();
    return () => {
      active = false;
    };
  }, [calendarMonth, currentPage, entryRevision]);

  useEffect(() => {
    let active = true;
    async function loadCalendarDay() {
      setCalendarDayLoading(true);
      setCalendarDayError("");
      try {
        const response = await getCalendarDay(calendarDate, calendarDayPage);
        if (!active) return;
        setCalendarEntries(response.data);
        setCalendarDayPagination(response.pagination);
        if (response.pagination.page !== calendarDayPage) {
          setCalendarDayPage(response.pagination.page);
        }
      } catch (requestError) {
        if (active) setCalendarDayError(requestError.message);
      } finally {
        if (active) setCalendarDayLoading(false);
      }
    }

    if (currentPage === "calendar") loadCalendarDay();
    return () => {
      active = false;
    };
  }, [calendarDate, calendarDayPage, currentPage, entryRevision]);

  useEffect(() => {
    let active = true;
    getStreak(today)
      .then((summary) => {
        if (active) setStreak(summary);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [entryRevision, today]);

  useEffect(() => {
    let active = true;
    async function loadTasks() {
      setTasksLoading(true);
      try {
        const [response, todayResponse] = await Promise.all([
          getTasks(taskQuery),
          getTasks({ date: today, page: 1, limit: 50 }),
        ]);
        if (!active) return;
        setTasks(response.data);
        setTaskPagination(response.pagination);
        if (response.pagination.page !== taskQuery.page) {
          setTaskQuery((current) => ({
            ...current,
            page: response.pagination.page,
          }));
        }
        setTodayTasks(todayResponse.data);
        setTaskError("");
      } catch (requestError) {
        if (active) setTaskError(requestError.message);
      } finally {
        if (active) setTasksLoading(false);
      }
    }

    loadTasks();
    return () => {
      active = false;
    };
  }, [taskQuery, taskRevision, today]);

  function startNewEntry() {
    clearUnlockTimer();
    setCurrentPage("diary");
    setSelectedEntry(null);
    setLockedEntryPreview(null);
    setEntryUnlocked(false);
    setUnlockError("");
    setEditingId(null);
    setIsEditing(true);
    setForm(emptyForm(darkMode ? "dark" : "light"));
    setPendingImages([]);
    setRemovedImageIds([]);
    setEditorResetKey((key) => key + 1);
    setError("");
  }

  async function viewEntry(entryOrId) {
    setError("");
    clearUnlockTimer();
    setEntryUnlocked(false);
    setUnlockError("");

    try {
      const entry =
        typeof entryOrId === "object"
          ? entryOrId
          : entries.find((item) => item._id === entryOrId) ||
            (await getEntry(entryOrId));
      setCurrentPage("diary");
      setSelectedEntry(entry);
      setPendingImages([]);
      setRemovedImageIds([]);
      setEditingId(entry._id);
      setIsEditing(false);
      if (entry.isLocked) {
        setLockedEntryPreview({
          _id: entry._id,
          date: entry.date,
          isLocked: true,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt,
          purgeRequestedAt: entry.purgeRequestedAt,
        });
        setForm(emptyForm(darkMode ? "dark" : "light"));
      } else {
        setLockedEntryPreview(null);
        setForm(entryFormValues(entry));
      }
      setEditorResetKey((key) => key + 1);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleUnlockEntry(currentPassword) {
    if (!lockedEntryPreview) return;
    setUnlockBusy(true);
    setUnlockError("");
    try {
      const entry = await unlockEntry(lockedEntryPreview._id, currentPassword);
      setSelectedEntry(entry);
      setForm(entryFormValues(entry));
      setEntryUnlocked(true);
      setIsEditing(false);
      setEditorResetKey((key) => key + 1);
    } catch (requestError) {
      setUnlockError(requestError.message);
    } finally {
      setUnlockBusy(false);
    }
  }

  async function handleLockEntry() {
    if (!selectedEntry || (selectedEntry.isLocked && !entryUnlocked)) return;
    setError("");
    try {
      const entry = await lockEntry(selectedEntry._id);
      clearUnlockTimer();
      const safePreview = {
        _id: entry._id,
        date: entry.date,
        isLocked: true,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt,
        purgeRequestedAt: entry.purgeRequestedAt,
      };
      setEntries((currentEntries) =>
        currentEntries.map((item) =>
          item._id === entry._id ? safePreview : item
        )
      );
      setCalendarEntries((currentEntries) =>
        currentEntries.filter((item) => item._id !== entry._id)
      );
      setSelectedEntry(entry);
      setLockedEntryPreview(safePreview);
      setEntryUnlocked(false);
      setForm(emptyForm(darkMode ? "dark" : "light"));
      setIsEditing(false);
      setEntryRevision((revision) => revision + 1);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handleFormChange(event) {
    const { name } = event.target;
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
  }

  function handleAddImages(event) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedFiles.length) return;
    const availableCount =
      maxEntryImages -
      ((selectedEntry?.images || []).filter(
        (image) => !removedImageIds.includes(image.id)
      ).length +
        pendingImages.length);
    if (selectedFiles.length > availableCount) {
      setError(`An entry can have at most ${maxEntryImages} images.`);
      return;
    }
    const invalidFile = selectedFiles.find(
      (file) =>
        !acceptedImageTypes.includes(file.type) || file.size > maxImageSize
    );
    if (invalidFile) {
      setError(
        `${invalidFile.name} is not a supported image or exceeds the 5 MB limit.`
      );
      return;
    }
    setError("");
    setPendingImages((current) => [...current, ...selectedFiles]);
  }

  function handleFormattingChange(name, value) {
    setForm((currentForm) => ({
      ...currentForm,
      formatting: { ...currentForm.formatting, [name]: value },
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (
      !form.isDraft &&
      (!form.title.trim() || !diaryTextContent(form.content))
    ) {
      setError("Please enter both a title and diary content before saving.");
      return;
    }

    setSaving(true);
    setError("");
    let persistedEntry = null;

    try {
      const { tagsText, ...entryValues } = form;
      const entryPayload = {
        ...entryValues,
        tags: tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      persistedEntry = editingId
        ? await updateEntry(editingId, entryPayload)
        : await createEntry(entryPayload);

      if (!editingId) {
        setEntryQuery((query) => ({ ...query, page: 1 }));
      }
      setEntryRevision((revision) => revision + 1);
      setSelectedEntry(persistedEntry);
      setEditingId(persistedEntry._id);
      for (const imageId of removedImageIds) {
        await deleteEntryImage(persistedEntry._id, imageId);
        persistedEntry = {
          ...persistedEntry,
          images: persistedEntry.images.filter((image) => image.id !== imageId),
        };
        setSelectedEntry(persistedEntry);
        setRemovedImageIds((current) => current.filter((id) => id !== imageId));
      }
      for (const file of pendingImages) {
        const { attachment } = await uploadEntryImage(persistedEntry._id, file);
        persistedEntry = {
          ...persistedEntry,
          images: [...(persistedEntry.images || []), attachment],
        };
        setSelectedEntry(persistedEntry);
        setPendingImages((current) => current.filter((item) => item !== file));
      }
      setPendingImages([]);
      setRemovedImageIds([]);
      setSelectedEntry(persistedEntry);
      setIsEditing(false);
      setForm(entryFormValues(persistedEntry));
      setEditorResetKey((key) => key + 1);
    } catch (requestError) {
      if (persistedEntry) {
        setSelectedEntry(persistedEntry);
        setEditingId(persistedEntry._id);
        setError(
          `Entry saved, but an image update failed: ${requestError.message}`
        );
      } else {
        setError(requestError.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry) {
    if (
      !window.confirm(
        `Move "${entry.isLocked ? "Locked entry" : entry.title || "Untitled entry"}" to Trash?`
      )
    ) {
      return;
    }

    setError("");

    try {
      await deleteEntry(entry._id);
      clearUnlockTimer();
      setEntryUnlocked(false);
      setLockedEntryPreview(null);
      setEntryRevision((revision) => revision + 1);
      setSelectedEntry((currentEntry) =>
        currentEntry?._id === entry._id ? null : currentEntry
      );
      if (editingId === entry._id) {
        startNewEntry();
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleAddTask(event) {
    event.preventDefault();
    const text = taskText.trim();
    if (!text) return;

    setTaskError("");
    try {
      const values = {
        text,
        dueDate: taskDate,
        priority: taskPriority,
        recurrence: taskRecurrence,
      };
      if (editingTaskId) {
        const task = await updateTask(editingTaskId, values);
        setTasks((currentTasks) =>
          currentTasks.map((item) => (item._id === task._id ? task : item))
        );
      } else {
        await createTask(values);
      }
      setTaskRevision((revision) => revision + 1);
      setTaskText("");
      setTaskDate(today);
      setTaskPriority("MEDIUM");
      setTaskRecurrence("NONE");
      setEditingTaskId(null);
    } catch (requestError) {
      setTaskError(requestError.message);
    }
  }

  async function handleAddSidebarTask(event) {
    event.preventDefault();
    const text = sidebarTaskText.trim();
    if (!text) return;

    setTaskError("");
    try {
      const task = await createTask({ text, date: today });
      setTasks((currentTasks) => [...currentTasks, task]);
      setSidebarTaskText("");
      setTaskRevision((revision) => revision + 1);
    } catch (requestError) {
      setTaskError(requestError.message);
    }
  }

  async function handleTaskToggle(task) {
    setTaskError("");
    try {
      const updatedTask = await updateTask(task._id, {
        status: task.status === "COMPLETED" ? "TODO" : "COMPLETED",
      });
      setTasks((currentTasks) =>
        currentTasks.map((item) =>
          item._id === updatedTask._id ? updatedTask : item
        )
      );
      setTaskRevision((revision) => revision + 1);
    } catch (requestError) {
      setTaskError(requestError.message);
    }
  }

  async function handleTaskStatus(task, status) {
    setTaskError("");
    try {
      const updatedTask = await updateTask(task._id, { status });
      setTasks((currentTasks) =>
        currentTasks.map((item) =>
          item._id === updatedTask._id ? updatedTask : item
        )
      );
      setTaskRevision((revision) => revision + 1);
    } catch (requestError) {
      setTaskError(requestError.message);
    }
  }

  function handleTaskEdit(task) {
    setTaskText(task.text);
    setTaskDate(task.dueDate);
    setTaskPriority(task.priority);
    setTaskRecurrence(task.recurrence);
    setEditingTaskId(task._id);
  }

  async function handleTaskDelete(task) {
    setTaskError("");
    try {
      await deleteTask(task._id);
      setTasks((currentTasks) =>
        currentTasks.filter((item) => item._id !== task._id)
      );
      setTaskRevision((revision) => revision + 1);
      if (editingTaskId === task._id) {
        setEditingTaskId(null);
        setTaskText("");
      }
    } catch (requestError) {
      setTaskError(requestError.message);
    }
  }

  function handleThemeToggle() {
    onThemeChange(darkMode ? "light" : "dark");
  }

  function downloadEntry() {
    if (!selectedEntry) return;

    const date = form.date || selectedEntry.date.slice(0, 10);
    const content = diaryTextContent(form.content);
    const text = `${form.title}\n${formatDate(date)}\n\n${content}\n`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diary-${date}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const panelClass = darkMode
    ? "border-stone-800 bg-stone-900 text-stone-100"
    : "border-stone-200 bg-white text-stone-800";

  return (
    <main
      className={`min-h-screen ${
        darkMode ? "bg-[#111613] text-stone-100" : "bg-[#f5f5f1] text-stone-800"
      }`}
    >
      <header
        className={`flex h-16 items-center justify-between border-b px-5 sm:px-8 ${
          darkMode
            ? "border-stone-800 bg-[#151b17]"
            : "border-stone-200/80 bg-white/90"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-800 text-sm font-semibold text-white shadow-sm">
            <span aria-hidden="true">✦</span>
          </span>
          <span>
            <span className="block text-lg font-semibold tracking-tight">
              MyDiary
            </span>
            <span
              className={`block text-[10px] font-medium uppercase tracking-[0.2em] ${darkMode ? "text-stone-500" : "text-stone-400"}`}
            >
              A little space for you
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs opacity-60 sm:inline">
            {user.displayName || user.email}
          </span>
          <button
            className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
              darkMode
                ? "bg-stone-800 text-stone-200 hover:bg-stone-700"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
            onClick={handleThemeToggle}
            type="button"
          >
            {darkMode ? "☀ Light Mode" : "☾ Dark Mode"}
          </button>
          <button
            className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
              darkMode
                ? "bg-stone-800 text-stone-200 hover:bg-stone-700"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
            disabled={loggingOut}
            onClick={handleLogout}
            type="button"
          >
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1440px] md:grid-cols-[264px_minmax(0,1fr)]">
        <aside
          className={`border-b p-4 md:border-b-0 md:border-r md:p-5 lg:p-6 ${
            darkMode ? "border-stone-800" : "border-stone-200"
          }`}
        >
          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-900"
            onClick={startNewEntry}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            New Entry
          </button>

          <nav aria-label="Diary navigation" className="mt-5 space-y-1">
            <button
              aria-current={currentPage === "dashboard" ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                currentPage === "dashboard"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => setCurrentPage("dashboard")}
              type="button"
            >
              <span aria-hidden="true">▥</span> Dashboard
            </button>
            <button
              aria-current={currentPage === "entries" ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                currentPage === "entries"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => {
                setCurrentPage("entries");
              }}
              type="button"
            >
              <span aria-hidden="true">▤</span> All Entries
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-xs opacity-70 ${darkMode ? "bg-white/10" : "bg-black/5"}`}
              >
                {entryPagination.total}
              </span>
            </button>
            <button
              aria-current={currentPage === "trash" ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                currentPage === "trash"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => setCurrentPage("trash")}
              type="button"
            >
              <span aria-hidden="true">▱</span> Trash
            </button>
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                currentPage === "tasks"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              aria-current={currentPage === "tasks" ? "page" : undefined}
              onClick={() => setCurrentPage("tasks")}
              type="button"
            >
              <span aria-hidden="true">☑</span> Tasks
            </button>
            <button
              aria-current={currentPage === "calendar" ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                currentPage === "calendar"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => setCurrentPage("calendar")}
              type="button"
            >
              <span aria-hidden="true">▦</span> Calendar
            </button>
            <button
              aria-current={currentPage === "settings" ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                currentPage === "settings"
                  ? darkMode
                    ? "bg-stone-800 text-stone-100"
                    : "bg-emerald-50 text-emerald-900"
                  : darkMode
                    ? "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => setCurrentPage("settings")}
              type="button"
            >
              <span aria-hidden="true">⚙</span> Settings
            </button>
          </nav>

          <section
            aria-label="Writing streak"
            className={`mt-5 rounded-xl border p-4 ${
              darkMode
                ? "border-stone-800 bg-stone-900/70"
                : "border-orange-100 bg-orange-50/70"
            }`}
          >
            <h2 className="text-sm font-semibold">Your writing rhythm</h2>
            <p className="mt-3 flex items-center gap-2 text-sm">
              <span aria-hidden="true">🔥</span> Current streak{" "}
              <strong className="ml-auto">
                {streak.current} {streak.current === 1 ? "day" : "days"}
              </strong>
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span aria-hidden="true">🏆</span> Personal best{" "}
              <strong className="ml-auto">
                {streak.longest} {streak.longest === 1 ? "day" : "days"}
              </strong>
            </p>
            <div
              className={`mt-3 border-t pt-3 text-sm ${
                darkMode ? "border-stone-800" : "border-orange-100"
              }`}
            >
              <p className="font-medium">Today's page</p>
              <p className="mt-1">
                {streak.writtenToday
                  ? "✓ You showed up today"
                  : "○ Your page is waiting"}
              </p>
            </div>
          </section>

          <section
            className={`mt-5 rounded-xl border p-4 ${
              darkMode
                ? "border-stone-800 bg-stone-900/70"
                : "border-stone-200 bg-white"
            }`}
          >
            {taskError && (
              <p className="mb-2 text-xs text-red-600" role="alert">
                {taskError}
              </p>
            )}
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => setCurrentPage("tasks")}
              type="button"
            >
              <span className="text-sm font-semibold">Today's tasks</span>
              <span className="text-xs opacity-60">
                {
                  todayTasks.filter((task) => task.status === "COMPLETED")
                    .length
                }{" "}
                / {todayTasks.length}
              </span>
            </button>
            {tasksLoading ? (
              <p className="mt-3 text-xs opacity-60">Loading tasks...</p>
            ) : todayTasks.length === 0 ? (
              <p className="mt-3 text-xs opacity-60">
                Nothing planned for today.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {todayTasks.map((task) => (
                  <li className="group flex items-center gap-2" key={task._id}>
                    <input
                      aria-label={`${task.status === "COMPLETED" ? "Unmark" : "Complete"} ${task.text}`}
                      checked={task.status === "COMPLETED"}
                      className="h-3.5 w-3.5 shrink-0 accent-emerald-700"
                      onChange={() => handleTaskToggle(task)}
                      type="checkbox"
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-xs ${
                        task.status === "COMPLETED"
                          ? "text-stone-400 line-through"
                          : ""
                      }`}
                    >
                      {task.text}
                    </span>
                    <button
                      aria-label={`Delete ${task.text}`}
                      className={`rounded px-1 text-sm opacity-70 transition sm:opacity-0 sm:group-hover:opacity-100 ${
                        darkMode
                          ? "text-stone-500 hover:bg-stone-800 hover:text-red-300"
                          : "text-stone-400 hover:bg-red-50 hover:text-red-700"
                      }`}
                      onClick={() => handleTaskDelete(task)}
                      type="button"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-3 flex gap-2" onSubmit={handleAddSidebarTask}>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Add a task for today</span>
                <input
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none transition focus:border-emerald-600 ${
                    darkMode
                      ? "border-stone-700 bg-stone-950 text-stone-100 placeholder:text-stone-500"
                      : "border-stone-200 bg-stone-50 text-stone-800 placeholder:text-stone-400"
                  }`}
                  maxLength={120}
                  onChange={(event) => setSidebarTaskText(event.target.value)}
                  placeholder="Add today's task..."
                  value={sidebarTaskText}
                />
              </label>
              <button
                aria-label="Add task for today"
                className="rounded-lg bg-emerald-700 px-3 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!sidebarTaskText.trim()}
                type="submit"
              >
                +
              </button>
            </form>
            <button
              className="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900"
              onClick={() => setCurrentPage("tasks")}
              type="button"
            >
              View all tasks →
            </button>
          </section>

          <div
            className={`mt-8 hidden rounded-xl border p-4 md:block ${
              darkMode
                ? "border-stone-800 bg-stone-900/60"
                : "border-amber-100 bg-amber-50/70"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              A gentle reminder
            </p>
            <p className="mt-2 text-sm leading-5 opacity-75">
              Take a moment to write down what matters today.
            </p>
          </div>
        </aside>

        <section className="min-w-0 p-4 sm:p-7 lg:p-10">
          <div className="mx-auto max-w-5xl">
            {currentPage !== "tasks" && error && (
              <p
                className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800"
                role="alert"
              >
                {error}
              </p>
            )}
            {currentPage === "tasks" ? (
              <TaskDashboard
                darkMode={darkMode}
                tasks={tasks}
                pagination={taskPagination}
                query={taskQuery}
                taskPriority={taskPriority}
                taskRecurrence={taskRecurrence}
                editingTaskId={editingTaskId}
                taskText={taskText}
                taskDate={taskDate}
                tasksLoading={tasksLoading}
                taskError={taskError}
                onTaskTextChange={setTaskText}
                onTaskDateChange={setTaskDate}
                onTaskPriorityChange={setTaskPriority}
                onTaskRecurrenceChange={setTaskRecurrence}
                onTaskQueryChange={setTaskQuery}
                onTaskEdit={handleTaskEdit}
                onTaskStatus={handleTaskStatus}
                onCancelTaskEdit={() => {
                  setEditingTaskId(null);
                  setTaskText("");
                  setTaskDate(today);
                  setTaskPriority("MEDIUM");
                  setTaskRecurrence("NONE");
                }}
                onAddTask={handleAddTask}
                onToggleTask={handleTaskToggle}
                onDeleteTask={handleTaskDelete}
              />
            ) : currentPage === "calendar" ? (
              <CalendarDashboard
                darkMode={darkMode}
                entries={calendarEntries}
                activity={calendarActivity}
                activityLoading={calendarActivityLoading}
                dayLoading={calendarDayLoading}
                dayPagination={calendarDayPagination}
                dayPage={calendarDayPage}
                activityError={calendarActivityError}
                dayError={calendarDayError}
                month={calendarMonth}
                selectedDate={calendarDate}
                onMonthChange={setCalendarMonth}
                onDateSelect={(date) => {
                  setCalendarDate(date);
                  setCalendarDayPage(1);
                }}
                onDayPageChange={setCalendarDayPage}
                onEntrySelect={viewEntry}
              />
            ) : currentPage === "entries" ? (
              <EntriesDashboard
                darkMode={darkMode}
                entries={entries}
                loading={loading}
                error={error}
                query={entryQuery}
                pagination={entryPagination}
                onQueryChange={setEntryQuery}
                selectedEntryId={selectedEntry?._id}
                onEntrySelect={viewEntry}
              />
            ) : currentPage === "trash" ? (
              <TrashDashboard
                darkMode={darkMode}
                revision={entryRevision}
                onMutation={() => setEntryRevision((revision) => revision + 1)}
              />
            ) : currentPage === "dashboard" ? (
              <Dashboard
                key={entryRevision}
                darkMode={darkMode}
                revision={entryRevision}
                onEntrySelect={viewEntry}
              />
            ) : currentPage === "settings" ? (
              <ProfileSettings
                user={user}
                darkMode={darkMode}
                themePreference={themePreference}
                onThemeChange={onThemeChange}
                onLogout={handleLogout}
                onAccountDeleted={onAccountDeleted}
                onProfileUpdate={onProfileUpdate}
                onNavigate={setCurrentPage}
              />
            ) : (
              <>
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-emerald-800">
                      {selectedEntry?.isLocked && !entryUnlocked
                        ? formatDate(selectedEntry.date)
                        : editingId
                          ? formatDate(form.date)
                          : "A fresh page"}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                      {selectedEntry?.isLocked && !entryUnlocked
                        ? "🔒 Locked entry"
                        : selectedEntry && !isEditing
                          ? selectedEntry.title || "Untitled entry"
                          : editingId
                            ? form.date === today
                              ? "Today's Entry"
                              : "Diary Entry"
                            : "Start writing"}
                    </h1>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedEntry && (
                      <>
                        {!isEditing &&
                          (!selectedEntry.isLocked || entryUnlocked) && (
                            <button
                              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                                darkMode
                                  ? "border-stone-700 hover:bg-stone-900"
                                  : "border-stone-300 hover:bg-white"
                              }`}
                              onClick={() => {
                                setIsEditing(true);
                                setEditorResetKey((key) => key + 1);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                          )}
                        {(!selectedEntry.isLocked || entryUnlocked) && (
                          <button
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                              darkMode
                                ? "border-stone-700 hover:bg-stone-900"
                                : "border-stone-300 hover:bg-white"
                            }`}
                            onClick={downloadEntry}
                            type="button"
                          >
                            ↓ <span className="hidden sm:inline">Download</span>
                          </button>
                        )}
                        {!isEditing &&
                          (selectedEntry.isLocked ? (
                            entryUnlocked && (
                              <button
                                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                                  darkMode
                                    ? "border-amber-800 text-amber-200 hover:bg-stone-900"
                                    : "border-amber-300 text-amber-900 hover:bg-amber-50"
                                }`}
                                onClick={handleLockEntry}
                                type="button"
                              >
                                Lock now
                              </button>
                            )
                          ) : (
                            <button
                              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                                darkMode
                                  ? "border-amber-800 text-amber-200 hover:bg-stone-900"
                                  : "border-amber-300 text-amber-900 hover:bg-amber-50"
                              }`}
                              onClick={handleLockEntry}
                              type="button"
                            >
                              🔒 Lock entry
                            </button>
                          ))}
                        <button
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                          onClick={() => handleDelete(selectedEntry)}
                          type="button"
                        >
                          Move to Trash
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <section
                  className={`overflow-hidden rounded-2xl border shadow-sm ${panelClass}`}
                >
                  {selectedEntry && !isEditing ? (
                    selectedEntry.isLocked && !entryUnlocked ? (
                      <LockedEntryPrompt
                        darkMode={darkMode}
                        entry={selectedEntry}
                        error={unlockError}
                        loading={unlockBusy}
                        onUnlock={handleUnlockEntry}
                      />
                    ) : (
                      <EntryReader entry={selectedEntry} darkMode={darkMode} />
                    )
                  ) : (
                    <EntryForm
                      key={`${editingId || "new"}-${editorResetKey}`}
                      form={form}
                      entryId={selectedEntry?._id}
                      images={selectedEntry?.images || []}
                      pendingImages={pendingImages}
                      removedImageIds={removedImageIds}
                      darkMode={darkMode}
                      onChange={handleFormChange}
                      onAddImages={handleAddImages}
                      onRemovePendingImage={(file) =>
                        setPendingImages((current) =>
                          current.filter((item) => item !== file)
                        )
                      }
                      onToggleImageRemoval={(imageId) =>
                        setRemovedImageIds((current) =>
                          current.includes(imageId)
                            ? current.filter((id) => id !== imageId)
                            : [...current, imageId]
                        )
                      }
                      onFormattingChange={handleFormattingChange}
                      onSubmit={handleSubmit}
                      saving={saving}
                      submitLabel={
                        form.isDraft
                          ? "Save draft"
                          : selectedEntry?.isDraft
                            ? "Publish entry"
                            : "Save entry"
                      }
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function EntriesDashboard({
  darkMode,
  entries,
  loading,
  error,
  query,
  pagination,
  onQueryChange,
  selectedEntryId,
  onEntrySelect,
}) {
  const [searchInput, setSearchInput] = useState(query.search);
  useEffect(() => {
    setSearchInput(query.search);
  }, [query.search]);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (searchInput !== query.search) {
        onQueryChange((current) => ({
          ...current,
          search: searchInput,
          page: 1,
        }));
      }
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [onQueryChange, query.search, searchInput]);

  const updateFilter = (changes) =>
    onQueryChange((current) => ({ ...current, ...changes, page: 1 }));
  const groupedEntries = entries.reduce((groups, entry) => {
    const date = entry.date?.slice(0, 10) || "Undated";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(entry);
    return groups;
  }, new Map());
  const sortedDates = [...groupedEntries.keys()].sort((first, second) =>
    second.localeCompare(first)
  );
  const cardClass = darkMode
    ? "border-stone-800 bg-[#171e19]"
    : "border-stone-200/80 bg-white";
  const fieldClass = darkMode
    ? "border-stone-700 bg-stone-900 text-stone-100 placeholder:text-stone-500"
    : "border-stone-200 bg-white text-stone-800 placeholder:text-stone-400";

  return (
    <section>
      <header className="mb-8 rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-[#315b49] px-6 py-7 text-white shadow-lg shadow-emerald-950/10 sm:px-9 sm:py-9">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Your personal archive
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              All your entries
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-6 text-emerald-100/80">
              Every thought, moment, and memory — thoughtfully gathered by day.
            </p>
          </div>
          <span className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-emerald-50 backdrop-blur">
            {pagination.total} {pagination.total === 1 ? "memory" : "memories"}
          </span>
        </div>
      </header>

      <label className="mb-7 block">
        <span className="sr-only">Search diary entries</span>
        <span
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-sm transition focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-700/10 ${fieldClass}`}
        >
          <span aria-hidden="true" className="text-lg opacity-45">
            ⌕
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search titles and your writing..."
            type="search"
            value={searchInput}
          />
          {searchInput && (
            <button
              aria-label="Clear search"
              className={`rounded-full px-2 py-1 text-xs opacity-60 transition hover:opacity-100 ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
              onClick={() => setSearchInput("")}
              type="button"
            >
              Clear
            </button>
          )}
        </span>
      </label>

      <div
        className={`mb-6 grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-4 ${
          darkMode
            ? "border-stone-800 bg-stone-900"
            : "border-stone-200 bg-white"
        }`}
      >
        <label className="text-xs font-medium">
          Mood
          <select
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            onChange={(event) => updateFilter({ mood: event.target.value })}
            value={query.mood}
          >
            <option value="">Any mood</option>
            {moodOptions.map((mood) => (
              <option key={mood.value} value={mood.value}>
                {mood.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium">
          Tags
          <input
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            maxLength={259}
            onChange={(event) => updateFilter({ tags: event.target.value })}
            placeholder="Comma-separated tags"
            value={query.tags}
          />
        </label>
        <label className="text-xs font-medium">
          Favorite
          <select
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            onChange={(event) => updateFilter({ favorite: event.target.value })}
            value={query.favorite}
          >
            <option value="">All entries</option>
            <option value="true">Favorites</option>
            <option value="false">Not favorites</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          Sort by
          <select
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(":");
              updateFilter({ sort, order });
            }}
            value={`${query.sort}:${query.order}`}
          >
            <option value="createdAt:desc">Newest created</option>
            <option value="createdAt:asc">Oldest created</option>
            <option value="updatedAt:desc">Recently updated</option>
            <option value="updatedAt:asc">Least recently updated</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          From
          <input
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            max={query.to || undefined}
            onChange={(event) => updateFilter({ from: event.target.value })}
            type="date"
            value={query.from}
          />
        </label>
        <label className="text-xs font-medium">
          To
          <input
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            min={query.from || undefined}
            onChange={(event) => updateFilter({ to: event.target.value })}
            type="date"
            value={query.to}
          />
        </label>
        <label className="text-xs font-medium">
          Entries per page
          <select
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${fieldClass}`}
            onChange={(event) =>
              updateFilter({ limit: Number(event.target.value) })
            }
            value={query.limit}
          >
            {[10, 25, 50].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            className="rounded-lg px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
            onClick={() => {
              setSearchInput("");
              onQueryChange(initialEntryQuery);
            }}
            type="button"
          >
            Clear filters
          </button>
        </div>
      </div>

      {error && (
        <p
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm opacity-65">
          Gathering your entries...
        </p>
      ) : error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800"
          role="alert"
        >
          Entries could not be loaded. {error}
        </p>
      ) : entries.length === 0 ? (
        <div
          className={`rounded-3xl border border-dashed px-6 py-14 text-center ${darkMode ? "border-stone-700" : "border-stone-300"}`}
        >
          <span aria-hidden="true" className="text-3xl">
            {query.search ||
            query.mood ||
            query.tags ||
            query.favorite ||
            query.from ||
            query.to
              ? "⌕"
              : "✧"}
          </span>
          <h2 className="mt-3 font-semibold">
            {query.search ||
            query.mood ||
            query.tags ||
            query.favorite ||
            query.from ||
            query.to
              ? "No entries found"
              : "Your story starts here"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 opacity-60">
            {query.search ||
            query.mood ||
            query.tags ||
            query.favorite ||
            query.from ||
            query.to
              ? "Try another word or phrase to find a memory."
              : "Once you write your first diary entry, it will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedDates.map((date) => {
            const dateEntries = groupedEntries.get(date);
            return (
              <section key={date}>
                <div className="mb-3 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-800 text-xs font-semibold text-white shadow-sm"
                  >
                    {date === "Undated"
                      ? "—"
                      : new Date(`${date}T00:00:00`).getDate()}
                  </span>
                  <div>
                    <h2 className="font-semibold tracking-tight">
                      {date === "Undated" ? date : formatDate(date)}
                    </h2>
                    <p className="mt-0.5 text-xs opacity-55">
                      {dateEntries.length}{" "}
                      {dateEntries.length === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                  <span
                    className={`ml-auto hidden h-px flex-1 sm:block ${darkMode ? "bg-stone-800" : "bg-stone-200"}`}
                  />
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {dateEntries.map((entry) => {
                    const preview = diaryTextContent(entry.content);
                    return (
                      <li key={entry._id}>
                        <button
                          aria-current={
                            selectedEntryId === entry._id ? "true" : undefined
                          }
                          className={`group flex h-full w-full flex-col rounded-2xl border p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                            selectedEntryId === entry._id
                              ? darkMode
                                ? "border-emerald-700 bg-emerald-950/40"
                                : "border-emerald-300 bg-emerald-50/50"
                              : `${cardClass} ${darkMode ? "hover:border-stone-600" : "hover:border-emerald-200"}`
                          }`}
                          onClick={() => onEntrySelect(entry)}
                          type="button"
                        >
                          <span className="flex w-full items-center justify-between gap-3">
                            <span className="truncate font-semibold tracking-tight">
                              {entry.isLocked
                                ? "🔒 Locked entry"
                                : entry.title || "Untitled entry"}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {!entry.isLocked && entry.isFavorite && (
                                <span aria-label="Favorite" title="Favorite">
                                  ★
                                </span>
                              )}
                              {!entry.isLocked && entry.isDraft && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                                  Draft
                                </span>
                              )}
                              <span
                                aria-hidden="true"
                                className="text-emerald-700 transition group-hover:translate-x-1"
                              >
                                →
                              </span>
                            </span>
                          </span>
                          <span className="mt-3 line-clamp-3 min-h-[4.5rem] w-full text-sm leading-6 opacity-65">
                            {entry.isLocked
                              ? "Private entry. Verify your password to view it."
                              : preview ||
                                "A quiet page, waiting for your words."}
                          </span>
                          {!entry.isLocked && (
                            <span className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-900">
                                {moodPresentation(entry.mood).emoji}{" "}
                                {moodPresentation(entry.mood).label}
                              </span>
                              {(entry.tags || []).map((tag) => (
                                <span
                                  className={`rounded-full px-2.5 py-1 ${
                                    darkMode
                                      ? "bg-stone-800 text-stone-300"
                                      : "bg-stone-100 text-stone-600"
                                  }`}
                                  key={tag}
                                >
                                  #{tag}
                                </span>
                              ))}
                            </span>
                          )}
                          <span
                            className={`mt-4 border-t pt-3 text-xs ${darkMode ? "border-stone-800 text-stone-400" : "border-stone-100 text-stone-500"}`}
                          >
                            Updated {formatTimestamp(entry.updatedAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {!loading && !error && pagination.total > 0 && (
        <nav
          aria-label="Entry pages"
          className={`mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm ${
            darkMode ? "border-stone-800" : "border-stone-200"
          }`}
        >
          <span className="opacity-65">
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={pagination.page <= 1}
              onClick={() =>
                onQueryChange((current) => ({
                  ...current,
                  page: current.page - 1,
                }))
              }
              type="button"
            >
              Previous
            </button>
            <span className="px-2">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={pagination.page >= pagination.totalPages}
              onClick={() =>
                onQueryChange((current) => ({
                  ...current,
                  page: current.page + 1,
                }))
              }
              type="button"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}

function TaskDashboard({
  darkMode,
  tasks,
  pagination,
  query,
  taskPriority,
  taskRecurrence,
  editingTaskId,
  taskText,
  taskDate,
  tasksLoading,
  taskError,
  onTaskTextChange,
  onTaskDateChange,
  onTaskPriorityChange,
  onTaskRecurrenceChange,
  onTaskQueryChange,
  onTaskEdit,
  onTaskStatus,
  onCancelTaskEdit,
  onAddTask,
  onToggleTask,
  onDeleteTask,
}) {
  const completedCount = tasks.filter(
    (task) => task.status === "COMPLETED"
  ).length;
  const groupedTasks = tasks.reduce((groups, task) => {
    const date = task.dueDate || task.date || "Undated";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(task);
    return groups;
  }, new Map());
  const sortedDates = [...groupedTasks.keys()].sort((first, second) =>
    second.localeCompare(first)
  );
  const inputClass = `rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-emerald-700 ${
    darkMode
      ? "border-stone-700 bg-stone-900 text-stone-100"
      : "border-stone-200 bg-white text-stone-800"
  }`;
  const today = todayAsInputValue();

  function updateFilter(changes) {
    onTaskQueryChange((current) => ({ ...current, ...changes, page: 1 }));
  }

  return (
    <section>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-800">
            Daily checklist
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Task dashboard
          </h1>
          <p className="mt-2 text-sm opacity-65">
            See tasks from every day and finish anything you missed.
          </p>
        </div>
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900">
          {completedCount} / {tasks.length} completed on this page
        </p>
      </header>

      {taskError && (
        <p
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {taskError}
        </p>
      )}

      <form
        className={`mb-5 grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 xl:grid-cols-6 ${
          darkMode
            ? "border-stone-800 bg-stone-900"
            : "border-stone-200 bg-white"
        }`}
        onSubmit={onAddTask}
      >
        <label className="min-w-0 xl:col-span-2">
          <span className="mb-1 block text-xs font-medium opacity-65">
            Task
          </span>
          <input
            className={`w-full ${inputClass}`}
            maxLength={120}
            onChange={(event) => onTaskTextChange(event.target.value)}
            placeholder="What would you like to do?"
            required
            value={taskText}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium opacity-65">
            Due date
          </span>
          <input
            className={`w-full ${inputClass}`}
            onChange={(event) => onTaskDateChange(event.target.value)}
            required
            type="date"
            value={taskDate}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium opacity-65">
            Priority
          </span>
          <select
            className={`w-full ${inputClass}`}
            onChange={(event) => onTaskPriorityChange(event.target.value)}
            value={taskPriority}
          >
            {["LOW", "MEDIUM", "HIGH"].map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium opacity-65">
            Repeat
          </span>
          <select
            className={`w-full ${inputClass}`}
            onChange={(event) => onTaskRecurrenceChange(event.target.value)}
            value={taskRecurrence}
          >
            <option value="NONE">Does not repeat</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </label>
        <button
          className="self-end rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-900 disabled:opacity-50"
          disabled={!taskText.trim()}
          type="submit"
        >
          {editingTaskId ? "Save changes" : "Add task"}
        </button>
        {editingTaskId && (
          <button
            className={`self-end rounded-lg border px-4 py-2.5 text-sm font-medium ${
              darkMode ? "border-stone-700" : "border-stone-300"
            }`}
            onClick={onCancelTaskEdit}
            type="button"
          >
            Cancel edit
          </button>
        )}
      </form>

      <div
        className={`mb-5 grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 xl:grid-cols-5 ${
          darkMode
            ? "border-stone-800 bg-stone-900"
            : "border-stone-200 bg-white"
        }`}
      >
        <label className="text-xs font-medium">
          Search
          <input
            className={`mt-1 block w-full ${inputClass}`}
            maxLength={100}
            onChange={(event) => updateFilter({ search: event.target.value })}
            placeholder="Find a task"
            value={query.search}
          />
        </label>
        <label className="text-xs font-medium">
          Status
          <select
            className={`mt-1 block w-full ${inputClass}`}
            onChange={(event) => updateFilter({ status: event.target.value })}
            value={query.status}
          >
            <option value="">All statuses</option>
            {["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium">
          Priority
          <select
            className={`mt-1 block w-full ${inputClass}`}
            onChange={(event) => updateFilter({ priority: event.target.value })}
            value={query.priority}
          >
            <option value="">All priorities</option>
            {["LOW", "MEDIUM", "HIGH"].map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium">
          Due from
          <input
            className={`mt-1 block w-full ${inputClass}`}
            max={query.to || undefined}
            onChange={(event) => updateFilter({ from: event.target.value })}
            type="date"
            value={query.from}
          />
        </label>
        <label className="text-xs font-medium">
          Due to
          <input
            className={`mt-1 block w-full ${inputClass}`}
            min={query.from || undefined}
            onChange={(event) => updateFilter({ to: event.target.value })}
            type="date"
            value={query.to}
          />
        </label>
      </div>

      {tasksLoading ? (
        <p className="py-8 text-center text-sm opacity-65">Loading tasks...</p>
      ) : sortedDates.length === 0 ? (
        <p
          className={`rounded-2xl border border-dashed px-5 py-10 text-center text-sm opacity-65 ${
            darkMode ? "border-stone-700" : "border-stone-300"
          }`}
        >
          No tasks yet. Add your first task above.
        </p>
      ) : (
        <div className="space-y-5">
          {sortedDates.map((date) => {
            const dateTasks = groupedTasks.get(date);
            const dayCompleted = dateTasks.filter(
              (task) => task.status === "COMPLETED"
            ).length;
            return (
              <section
                className={`overflow-hidden rounded-2xl border ${
                  darkMode
                    ? "border-stone-800 bg-stone-900"
                    : "border-stone-200 bg-white"
                }`}
                key={date}
              >
                <header
                  className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${
                    darkMode ? "border-stone-800" : "border-stone-100"
                  }`}
                >
                  <h2 className="text-sm font-semibold">
                    {date === "Undated" ? date : formatDate(date)}
                  </h2>
                  <span className="text-xs opacity-60">
                    {dayCompleted} / {dateTasks.length} completed
                  </span>
                </header>
                <ul>
                  {dateTasks.map((task) => (
                    <li
                      className={`group flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0 ${
                        darkMode ? "border-stone-800" : "border-stone-100"
                      }`}
                      key={task._id}
                    >
                      <input
                        aria-label={`${task.status === "COMPLETED" ? "Unmark" : "Complete"} ${task.text}`}
                        checked={task.status === "COMPLETED"}
                        className="h-4 w-4 shrink-0 accent-emerald-700"
                        onChange={() => onToggleTask(task)}
                        type="checkbox"
                      />
                      <span
                        className={`min-w-0 flex-1 break-words text-sm ${
                          task.status === "COMPLETED"
                            ? "text-stone-400 line-through"
                            : ""
                        }`}
                      >
                        {task.text}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          task.priority === "HIGH"
                            ? "bg-rose-100 text-rose-800"
                            : task.priority === "LOW"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {task.priority}
                      </span>
                      {date !== "Undated" && (
                        <span
                          className={`text-[11px] ${
                            date < today &&
                            !["COMPLETED", "CANCELLED"].includes(task.status)
                              ? "font-semibold text-red-600"
                              : "opacity-60"
                          }`}
                        >
                          {date < today &&
                          !["COMPLETED", "CANCELLED"].includes(task.status)
                            ? "Overdue · "
                            : "Due · "}
                          {formatDate(date)}
                        </span>
                      )}
                      {task.recurrence !== "NONE" && (
                        <span className="hidden text-xs opacity-55 lg:inline">
                          ↻ {task.recurrence.toLowerCase()}
                        </span>
                      )}
                      <select
                        aria-label={`Status for ${task.text}`}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          darkMode
                            ? "border-stone-700 bg-stone-900"
                            : "border-stone-200 bg-white"
                        }`}
                        onChange={(event) =>
                          onTaskStatus(task, event.target.value)
                        }
                        value={task.status}
                      >
                        {["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(
                          (status) => (
                            <option key={status} value={status}>
                              {status.replace("_", " ")}
                            </option>
                          )
                        )}
                      </select>
                      <button
                        aria-label={`Edit ${task.text}`}
                        className={`rounded-md px-2 py-1 text-sm ${
                          darkMode ? "hover:bg-stone-800" : "hover:bg-stone-100"
                        }`}
                        onClick={() => onTaskEdit(task)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        aria-label={`Delete ${task.text}`}
                        className={`rounded-md px-2 py-1 text-sm transition sm:opacity-0 sm:group-hover:opacity-100 ${
                          darkMode
                            ? "text-stone-500 hover:bg-stone-800 hover:text-red-300"
                            : "text-stone-400 hover:bg-red-50 hover:text-red-700"
                        }`}
                        onClick={() => onDeleteTask(task)}
                        type="button"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {!tasksLoading && pagination.totalPages > 1 && (
        <nav
          aria-label="Task pages"
          className={`mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm ${
            darkMode ? "border-stone-800" : "border-stone-200"
          }`}
        >
          <span className="opacity-65">
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-lg border px-3 py-2 disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={pagination.page <= 1}
              onClick={() =>
                onTaskQueryChange((current) => ({
                  ...current,
                  page: current.page - 1,
                }))
              }
              type="button"
            >
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className={`rounded-lg border px-3 py-2 disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={pagination.page >= pagination.totalPages}
              onClick={() =>
                onTaskQueryChange((current) => ({
                  ...current,
                  page: current.page + 1,
                }))
              }
              type="button"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}

function CalendarDashboard({
  darkMode,
  entries,
  activity,
  activityLoading,
  dayLoading,
  activityError,
  dayError,
  dayPagination,
  dayPage,
  month,
  selectedDate,
  onMonthChange,
  onDateSelect,
  onDayPageChange,
  onEntrySelect,
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const activityByDate = new Map(
    activity.map(({ date, count }) => [date, count])
  );
  const writtenDates = new Set(activityByDate.keys());
  const selectedEntries = entries.filter(
    (entry) => !entry.isDraft && entry.date.slice(0, 10) === selectedDate
  );
  const today = todayAsInputValue();
  const monthEntryDates = [...writtenDates];
  const elapsedDays = Array.from({ length: daysInMonth }, (_, index) =>
    localDateKey(year, monthIndex, index + 1)
  ).filter((date) => date <= today).length;
  const writtenDays = monthEntryDates.filter((date) => date <= today).length;
  const missedDays = Math.max(0, elapsedDays - writtenDays);
  const writingRate = elapsedDays
    ? Math.round((writtenDays / elapsedDays) * 100)
    : 0;
  const error = [activityError, dayError].filter(Boolean).join(" ");
  const cellClass = darkMode
    ? "border-stone-800 bg-stone-900"
    : "border-stone-200 bg-white";

  function changeMonth(offset) {
    const nextMonth = new Date(year, monthIndex + offset, 1);
    onMonthChange(nextMonth);
    onDateSelect(
      localDateKey(nextMonth.getFullYear(), nextMonth.getMonth(), 1)
    );
  }

  function goToToday() {
    const currentDate = new Date();
    onMonthChange(
      new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    );
    onDateSelect(today);
  }

  return (
    <section>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-800">
            Your writing history
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Diary Calendar
          </h1>
          <p className="mt-2 text-sm opacity-65">
            Choose a day to see the entries you wrote.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
              darkMode
                ? "border-stone-700 bg-stone-900 text-stone-200 hover:border-stone-600 hover:bg-stone-800"
                : "border-stone-200 bg-white text-stone-600 shadow-sm hover:border-stone-300 hover:bg-stone-50"
            }`}
            onClick={goToToday}
            type="button"
          >
            Today
          </button>
          <div
            aria-label="Calendar month navigation"
            className={`grid grid-cols-[40px_minmax(132px,1fr)_40px] items-center rounded-2xl border p-1.5 shadow-sm ${
              darkMode
                ? "border-stone-700 bg-stone-900"
                : "border-stone-200 bg-white"
            }`}
          >
            <button
              aria-label="Previous month"
              className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition ${
                darkMode
                  ? "text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                  : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => changeMonth(-1)}
              type="button"
            >
              ‹
            </button>
            <span
              aria-live="polite"
              className="whitespace-nowrap px-2 text-center text-sm font-semibold tracking-tight"
            >
              {formatMonth(month)}
            </span>
            <button
              aria-label="Next month"
              className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition ${
                darkMode
                  ? "text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                  : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              }`}
              onClick={() => changeMonth(1)}
              type="button"
            >
              ›
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          Calendar data could not be loaded. {error}
        </p>
      )}

      <section
        aria-label={`${formatMonth(month)} writing summary`}
        className="mb-5 grid gap-3 sm:grid-cols-3"
      >
        <div
          className={`rounded-2xl border p-4 ${darkMode ? "border-emerald-900/70 bg-emerald-950/30" : "border-emerald-100 bg-emerald-50/70"}`}
        >
          <p
            className={`text-xs font-medium ${darkMode ? "text-emerald-200/70" : "text-emerald-800/70"}`}
          >
            Writing days
          </p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span aria-hidden="true">🔥</span>
            {activityLoading || activityError ? "—" : writtenDays}
            <span className="text-xs font-normal opacity-55">this month</span>
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${darkMode ? "border-amber-900/50 bg-amber-950/20" : "border-amber-100 bg-amber-50/60"}`}
        >
          <p
            className={`text-xs font-medium ${darkMode ? "text-amber-200/70" : "text-amber-900/70"}`}
          >
            Quiet days
          </p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span aria-hidden="true">😢</span>
            {activityLoading || activityError ? "—" : missedDays}
            <span className="text-xs font-normal opacity-55">so far</span>
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${darkMode ? "border-stone-800 bg-stone-900" : "border-stone-200 bg-white"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium opacity-65">Monthly rhythm</p>
            <span className="text-sm font-semibold">
              {activityLoading || activityError || !elapsedDays
                ? "—"
                : `${writingRate}%`}
            </span>
          </div>
          <div
            aria-label={
              activityLoading || activityError || !elapsedDays
                ? "Monthly rhythm unavailable"
                : `${writingRate}% of elapsed days have an entry`
            }
            className={`mt-3 h-2 overflow-hidden rounded-full ${darkMode ? "bg-stone-800" : "bg-stone-100"}`}
            role="img"
          >
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width] duration-500"
              style={{
                width: `${activityLoading || activityError ? 0 : writingRate}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[11px] opacity-50">
            {activityError
              ? "Activity unavailable"
              : elapsedDays
                ? `${writtenDays} of ${elapsedDays} days`
                : "Your month is just beginning"}
          </p>
        </div>
      </section>

      <section
        className={`rounded-3xl border p-3 shadow-sm sm:p-5 ${cellClass}`}
      >
        <div className="mb-2 grid grid-cols-7">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
            <span
              className="py-2 text-center text-xs font-medium text-stone-500"
              key={weekday}
            >
              {weekday}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {cells.map((day, index) => {
            if (day === null) {
              return (
                <span
                  aria-hidden="true"
                  className="min-h-12 sm:min-h-16"
                  key={`blank-${index}`}
                />
              );
            }

            const date = localDateKey(year, monthIndex, day);
            const dateEntryCount = activityByDate.get(date) || 0;
            const hasEntry = dateEntryCount > 0;
            const isSelected = selectedDate === date;
            const isMissed = !hasEntry && date < today;
            const isToday = date === today;
            return (
              <button
                aria-label={`${formatDate(date)}${hasEntry ? `, ${dateEntryCount} diary ${dateEntryCount === 1 ? "entry" : "entries"}` : isMissed ? ", missed writing day" : isToday ? ", today, no entry yet" : ""}`}
                aria-pressed={isSelected}
                className={`group relative flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-xl text-sm transition sm:min-h-[4.5rem] ${
                  isSelected
                    ? "bg-emerald-800 font-semibold text-white"
                    : isToday
                      ? darkMode
                        ? "bg-stone-800 font-semibold text-stone-100 ring-1 ring-inset ring-emerald-700"
                        : "bg-emerald-50 font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200"
                      : darkMode
                        ? hasEntry
                          ? "bg-emerald-950/30 hover:bg-emerald-950/60"
                          : isMissed
                            ? "bg-amber-950/15 hover:bg-amber-950/30"
                            : "hover:bg-stone-800"
                        : hasEntry
                          ? "bg-emerald-50/70 hover:bg-emerald-100"
                          : isMissed
                            ? "bg-amber-50/60 hover:bg-amber-100/80"
                            : "hover:bg-stone-100"
                }`}
                key={date}
                onClick={() => onDateSelect(date)}
                type="button"
                title={`${formatDate(date)} · ${hasEntry ? `${dateEntryCount} ${dateEntryCount === 1 ? "entry" : "entries"} written` : isMissed ? "Missed day" : isToday ? "Today — your page is waiting" : "No entry"}`}
              >
                {isToday && (
                  <span
                    className={`absolute right-1 top-1 text-[8px] font-bold uppercase tracking-wide sm:right-2 sm:top-2 ${isSelected ? "text-emerald-100" : "text-emerald-700"}`}
                  >
                    Today
                  </span>
                )}
                <span className="leading-none">{day}</span>
                {(hasEntry || isMissed) && (
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 place-items-center rounded-full text-[12px] leading-none transition-transform group-hover:scale-110 sm:h-6 sm:w-6 sm:text-sm ${
                      isSelected
                        ? "bg-white/15"
                        : hasEntry
                          ? darkMode
                            ? "bg-emerald-900/70"
                            : "bg-emerald-100"
                          : darkMode
                            ? "bg-amber-900/50"
                            : "bg-amber-100"
                    }`}
                  >
                    {hasEntry ? "🔥" : "😢"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p
          className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs ${darkMode ? "border-stone-800 text-stone-400" : "border-stone-100 text-stone-500"}`}
        >
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">🔥</span> Entry written
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">😢</span> Past day missed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-sm border border-emerald-500"
            />{" "}
            Today
          </span>
        </p>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{formatDate(selectedDate)}</h2>
          <span className="text-sm opacity-60">
            {dayPagination.total}{" "}
            {dayPagination.total === 1 ? "entry" : "entries"}
          </span>
        </div>
        {dayLoading ? (
          <p className="py-6 text-sm opacity-65">Loading diary entries...</p>
        ) : dayError ? (
          <p className="py-6 text-sm opacity-65">
            Entries are unavailable until the calendar data loads.
          </p>
        ) : selectedEntries.length === 0 ? (
          <p
            className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm opacity-65 ${
              darkMode ? "border-stone-700" : "border-stone-300"
            }`}
          >
            No diary entries for this day.
          </p>
        ) : (
          <ul className="space-y-2">
            {selectedEntries.map((entry) => (
              <li key={entry._id}>
                <button
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    darkMode
                      ? "border-stone-800 bg-stone-900 hover:border-stone-600"
                      : "border-stone-200 bg-white hover:border-emerald-300"
                  }`}
                  onClick={() => onEntrySelect(entry)}
                  type="button"
                >
                  <span className="block font-medium">
                    {entry.isLocked
                      ? "🔒 Locked entry"
                      : entry.title || "Untitled entry"}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-sm opacity-60">
                    {entry.isLocked
                      ? "Private entry"
                      : diaryTextContent(entry.content) || "No writing yet"}
                  </span>
                  <span className="mt-2 block text-xs font-medium text-emerald-700">
                    Open entry →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!dayLoading && !dayError && dayPagination.totalPages > 1 && (
          <nav
            aria-label="Selected day's entry pages"
            className="mt-4 flex items-center justify-end gap-3 text-sm"
          >
            <button
              className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={dayPage <= 1}
              onClick={() => onDayPageChange((page) => page - 1)}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {dayPage} of {dayPagination.totalPages}
            </span>
            <button
              className={`rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                darkMode ? "border-stone-700" : "border-stone-300"
              }`}
              disabled={dayPage >= dayPagination.totalPages}
              onClick={() => onDayPageChange((page) => page + 1)}
              type="button"
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </section>
  );
}

function EntryForm({
  form,
  entryId,
  images,
  pendingImages,
  removedImageIds,
  darkMode,
  onChange,
  onAddImages,
  onRemovePendingImage,
  onToggleImageRemoval,
  onFormattingChange,
  onSubmit,
  saving,
  submitLabel,
}) {
  const editorRef = useRef(null);
  const savedSelectionRef = useRef(null);
  const [pendingPreviews, setPendingPreviews] = useState([]);
  const formatting = form.formatting;
  const isPresetSize = sizePresets.some(
    (preset) => preset.size === formatting.fontSize
  );
  const controlClass = darkMode
    ? "rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-stone-100"
    : "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800";
  const editorTextColor =
    formatting.pageStyle === "dark" &&
    formatting.textColor.toLowerCase() === "#292524"
      ? "#f5f5f4"
      : formatting.textColor;

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = sanitizeDiaryHtml(form.content);
    }
  }, []);

  useEffect(() => {
    const previews = pendingImages.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPendingPreviews(previews);
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [pendingImages]);

  function saveSelection() {
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      editorRef.current?.contains(
        selection.getRangeAt(0).commonAncestorContainer
      )
    ) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (savedSelectionRef.current && selection && editorRef.current) {
      editorRef.current.focus();
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current);
    }
  }

  function applyFormat(command) {
    restoreSelection();
    document.execCommand(command, false);
    if (editorRef.current) {
      onChange({
        target: {
          name: "content",
          value: sanitizeDiaryHtml(editorRef.current.innerHTML),
        },
      });
    }
  }

  function handleEditorInput(event) {
    onChange({
      target: {
        name: "content",
        value: sanitizeDiaryHtml(event.currentTarget.innerHTML),
      },
    });
  }

  function handleTextColor(event) {
    const color = event.target.value;
    onFormattingChange("textColor", color);
    restoreSelection();
    document.execCommand("foreColor", false, color);
    if (editorRef.current) {
      onChange({
        target: {
          name: "content",
          value: sanitizeDiaryHtml(editorRef.current.innerHTML),
        },
      });
    }
  }

  function handleSizeSelect(event) {
    if (event.target.value === "custom") {
      onFormattingChange("fontSize", 20);
    } else {
      onFormattingChange("fontSize", Number(event.target.value));
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div
        className={`grid gap-4 border-b p-4 pb-5 sm:grid-cols-[minmax(0,1fr)_180px] sm:px-6 ${
          darkMode ? "border-stone-800" : "border-stone-200"
        }`}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide opacity-60">
            Title
          </span>
          <input
            className={`w-full text-xl font-medium outline-none placeholder:opacity-40 sm:text-2xl ${
              darkMode ? "bg-stone-900" : "bg-white"
            }`}
            name="title"
            maxLength={160}
            onChange={onChange}
            placeholder="Give your entry a title..."
            required={!form.isDraft}
            value={form.title}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide opacity-60">
            Entry date
          </span>
          <input
            className={`w-full cursor-not-allowed opacity-70 ${controlClass}`}
            disabled
            name="date"
            type="date"
            value={form.date}
          />
        </label>
      </div>

      <div className="grid gap-4 px-4 sm:grid-cols-2 sm:px-6">
        <label className="block text-sm font-medium">
          Mood
          <select
            className={`mt-1.5 w-full ${controlClass}`}
            name="mood"
            onChange={onChange}
            value={form.mood}
          >
            {moodOptions.map((mood) => (
              <option key={mood.value} value={mood.value}>
                {mood.emoji} {mood.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Tags
          <input
            className={`mt-1.5 w-full ${controlClass}`}
            maxLength={259}
            name="tagsText"
            onChange={onChange}
            placeholder="Work, family, weekend"
            value={form.tagsText}
          />
          <span className="mt-1 block text-xs font-normal opacity-55">
            Separate up to 10 tags with commas.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={form.isFavorite}
            className="h-4 w-4 accent-amber-600"
            name="isFavorite"
            onChange={onChange}
            type="checkbox"
          />
          <span>★ Favorite entry</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={form.isDraft}
            className="h-4 w-4 accent-emerald-700"
            name="isDraft"
            onChange={onChange}
            type="checkbox"
          />
          <span>Save as a draft</span>
        </label>
      </div>

      <section
        aria-label="Entry images"
        className={`mx-4 rounded-xl border p-4 sm:mx-6 ${
          darkMode
            ? "border-stone-700 bg-stone-950/40"
            : "border-stone-200 bg-stone-50/70"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Images</h2>
            <p className="mt-1 text-xs opacity-60">
              JPEG, PNG, or WebP · up to 5 MB each · up to {maxEntryImages} per
              entry
            </p>
          </div>
          <label
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium ${controlClass}`}
          >
            Add images
            <input
              accept={acceptedImageTypes.join(",")}
              className="sr-only"
              disabled={
                saving ||
                images.length - removedImageIds.length + pendingImages.length >=
                  maxEntryImages
              }
              multiple
              onChange={onAddImages}
              type="file"
            />
          </label>
        </div>
        {(images.length > 0 || pendingPreviews.length > 0) && (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => {
              const removed = removedImageIds.includes(image.id);
              return (
                <li
                  className={`overflow-hidden rounded-lg border ${
                    removed ? "opacity-50" : ""
                  } ${darkMode ? "border-stone-700" : "border-stone-200"}`}
                  key={image.id}
                >
                  <img
                    alt={image.originalName}
                    className="h-36 w-full bg-black/5 object-contain"
                    src={`/api/entries/${entryId}/images/${image.id}`}
                  />
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="min-w-0 truncate text-xs">
                      {image.originalName}
                    </span>
                    <button
                      className="shrink-0 text-xs font-medium text-emerald-700"
                      disabled={saving}
                      onClick={() => onToggleImageRemoval(image.id)}
                      type="button"
                    >
                      {removed ? "Keep" : "Remove"}
                    </button>
                  </div>
                </li>
              );
            })}
            {pendingPreviews.map(({ file, url }) => (
              <li
                className={`overflow-hidden rounded-lg border ${
                  darkMode ? "border-stone-700" : "border-stone-200"
                }`}
                key={`${file.name}-${file.lastModified}-${file.size}`}
              >
                <img
                  alt={`Preview of ${file.name}`}
                  className="h-36 w-full bg-black/5 object-contain"
                  src={url}
                />
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="min-w-0 truncate text-xs">{file.name}</span>
                  <button
                    className="shrink-0 text-xs font-medium text-red-700"
                    disabled={saving}
                    onClick={() => onRemovePendingImage(file)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        aria-label="Text formatting"
        className={`mx-4 flex flex-wrap items-center gap-2 rounded-xl border p-2.5 sm:mx-6 ${
          darkMode
            ? "border-stone-700 bg-stone-950/60"
            : "border-stone-200 bg-stone-50/80"
        }`}
      >
        <label className="sr-only" htmlFor="font-family">
          Font family
        </label>
        <select
          className={`${controlClass} max-w-[150px]`}
          id="font-family"
          onChange={(event) =>
            onFormattingChange("fontFamily", event.target.value)
          }
          title="Font family"
          value={formatting.fontFamily}
        >
          {fontFamilies.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="font-size">
          Font size
        </label>
        <select
          className={`${controlClass} w-[112px]`}
          id="font-size"
          onChange={handleSizeSelect}
          title="Font size"
          value={isPresetSize ? formatting.fontSize : "custom"}
        >
          {sizePresets.map((preset) => (
            <option key={preset.size} value={preset.size}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom size</option>
        </select>
        {!isPresetSize && (
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <span className="sr-only">Custom font size in pixels</span>
            <input
              aria-label="Custom font size in pixels"
              className={`${controlClass} w-[76px]`}
              max="36"
              min="12"
              onChange={(event) =>
                onFormattingChange(
                  "fontSize",
                  Math.min(36, Math.max(12, Number(event.target.value) || 12))
                )
              }
              required
              type="number"
              value={formatting.fontSize}
            />
            px
          </label>
        )}

        <span
          aria-hidden="true"
          className={`mx-0.5 hidden h-7 border-l sm:block ${
            darkMode ? "border-stone-700" : "border-stone-300"
          }`}
        />
        <div
          aria-label="Text style"
          className={`flex rounded-lg border p-0.5 ${
            darkMode ? "border-stone-700" : "border-stone-300"
          }`}
        >
          <button
            aria-label="Bold"
            className={`${controlClass} border-0 px-2.5`}
            onClick={() => applyFormat("bold")}
            onMouseDown={saveSelection}
            title="Bold"
            type="button"
          >
            <strong>B</strong>
          </button>
          <button
            aria-label="Italic"
            className={`${controlClass} border-0 px-2.5`}
            onClick={() => applyFormat("italic")}
            onMouseDown={saveSelection}
            title="Italic"
            type="button"
          >
            <em>I</em>
          </button>
          <button
            aria-label="Underline"
            className={`${controlClass} border-0 px-2.5`}
            onClick={() => applyFormat("underline")}
            onMouseDown={saveSelection}
            title="Underline"
            type="button"
          >
            <u>U</u>
          </button>
        </div>

        <label
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2 text-xs ${
            darkMode
              ? "border-stone-700 text-stone-400"
              : "border-stone-300 text-stone-500"
          }`}
        >
          <span className="sr-only">Text color</span>
          <input
            aria-label="Text color"
            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            onChange={handleTextColor}
            onMouseDown={saveSelection}
            title="Text color"
            type="color"
            value={formatting.textColor}
          />
        </label>

        <label className="sr-only" htmlFor="text-align">
          Text alignment
        </label>
        <select
          className={`${controlClass} w-[112px]`}
          id="text-align"
          onChange={(event) =>
            onFormattingChange("textAlign", event.target.value)
          }
          title="Text alignment"
          value={formatting.textAlign}
        >
          <option value="left">Align left</option>
          <option value="center">Align center</option>
          <option value="right">Align right</option>
        </select>

        <label className="sr-only" htmlFor="page-style">
          Page style
        </label>
        <select
          className={`${controlClass} min-w-[130px] flex-1 sm:flex-none`}
          id="page-style"
          onChange={(event) =>
            onFormattingChange("pageStyle", event.target.value)
          }
          title="Page style"
          value={formatting.pageStyle}
        >
          {pageStyles.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      </div>

      <label className="block">
        <span className="sr-only">Entry</span>
        <div
          aria-label="Diary entry"
          className={`diary-editor min-h-[360px] w-full border-y border-stone-200 px-5 py-6 leading-8 outline-none focus:border-emerald-700 sm:min-h-[440px] sm:px-8 ${
            darkMode ? "border-stone-800" : "border-stone-100"
          } ${pageStyleClass(formatting.pageStyle)}`}
          contentEditable
          onInput={handleEditorInput}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          ref={editorRef}
          role="textbox"
          style={{
            fontFamily: formatting.fontFamily,
            fontSize: `${formatting.fontSize}px`,
            color: editorTextColor,
            textAlign: formatting.textAlign,
          }}
          data-placeholder="Write about your day..."
          suppressContentEditableWarning
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
        <span className="text-xs opacity-50">
          {textPreview(form.content).split(/\s+/).filter(Boolean).length} words
        </span>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-900 disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving..." : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
