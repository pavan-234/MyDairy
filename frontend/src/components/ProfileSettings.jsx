import { useEffect, useState } from "react";
import BackupSettings from "./BackupSettings.jsx";
import {
  changePassword,
  deleteAccount,
  getProfile,
  updateProfile,
} from "../api/profile.js";

const themeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Use system preference" },
];

function inputClass(darkMode) {
  return `mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
    darkMode
      ? "border-stone-700 bg-stone-950 text-stone-100"
      : "border-stone-200 bg-white text-stone-800"
  }`;
}

export default function ProfileSettings({
  user,
  darkMode,
  themePreference,
  onThemeChange,
  onLogout,
  onAccountDeleted,
  onProfileUpdate,
  onNavigate,
}) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState(user.displayName || "");
  const [notificationPreferences, setNotificationPreferences] = useState({
    browserNotifications: false,
    taskReminders: false,
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    getProfile()
      .then(({ profile: currentProfile }) => {
        if (!active) return;
        setProfile(currentProfile);
        setName(currentProfile.displayName || "");
        setNotificationPreferences(currentProfile.notificationPreferences);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const panelClass = `rounded-2xl border p-5 sm:p-6 ${
    darkMode ? "border-stone-800 bg-stone-900" : "border-stone-200 bg-white"
  }`;
  const buttonClass =
    "rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50";

  async function saveProfile(event) {
    event.preventDefault();
    setProfileSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateProfile({ displayName: name });
      setProfile(result.profile);
      setName(result.profile.displayName);
      onProfileUpdate(result.profile);
      setNotice("Profile updated.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveNotifications(event) {
    event.preventDefault();
    setProfileSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateProfile({
        notificationPreferences,
      });
      setProfile(result.profile);
      setNotificationPreferences(result.profile.notificationPreferences);
      setNotice("Notification preferences saved.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const result = await changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  async function submitDeletion(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (deleteConfirmation !== "DELETE") {
      setError('Type "DELETE" to confirm permanent deletion.');
      return;
    }
    if (
      !window.confirm(
        "Permanently delete your account and all diary entries, Trash, tasks, images, and backup history? This cannot be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount({
        currentPassword: deletePassword,
        confirmation: deleteConfirmation,
      });
      onAccountDeleted();
    } catch (requestError) {
      setError(requestError.message);
      setDeleting(false);
    }
  }

  const createdAt = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <section className="space-y-5">
      <header className="mb-7">
        <p className="text-sm font-medium text-emerald-700">
          Your account and preferences
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Profile &amp; Settings
        </h1>
        <p className="mt-2 text-sm opacity-65">
          Manage your profile, security, appearance, and data.
        </p>
      </header>

      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          role="status"
        >
          {notice}
        </p>
      )}

      <section aria-labelledby="profile-heading" className={panelClass}>
        <h2 className="text-lg font-semibold" id="profile-heading">
          Profile
        </h2>
        {profileLoading ? (
          <p aria-live="polite" className="mt-3 text-sm opacity-65">
            Loading profile…
          </p>
        ) : profile ? (
          <form className="mt-4 max-w-xl space-y-4" onSubmit={saveProfile}>
            <label className="block text-sm font-medium" htmlFor="profile-name">
              Name
              <input
                autoComplete="name"
                className={inputClass(darkMode)}
                id="profile-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <div>
              <span className="text-sm font-medium">Email</span>
              <p className="mt-1 rounded-lg border border-transparent px-3 py-2 text-sm opacity-70">
                {profile.email}
              </p>
              <p className="text-xs opacity-55">
                Email changes are unavailable until email verification is
                supported.
              </p>
            </div>
            <div>
              <span className="text-sm font-medium">Account created</span>
              <p className="mt-1 text-sm opacity-70">{createdAt}</p>
            </div>
            <button
              className={buttonClass}
              disabled={profileSaving}
              type="submit"
            >
              {profileSaving ? "Saving…" : "Save profile"}
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm opacity-65">
            Profile could not be loaded.
          </p>
        )}
      </section>

      <section aria-labelledby="security-heading" className={panelClass}>
        <h2 className="text-lg font-semibold" id="security-heading">
          Security
        </h2>
        <p className="mt-1 text-sm opacity-65">
          Changing your password signs out other sessions. Your current session
          remains active.
        </p>
        <form className="mt-4 max-w-xl space-y-4" onSubmit={submitPassword}>
          <label
            className="block text-sm font-medium"
            htmlFor="current-password"
          >
            Current password
            <input
              autoComplete="current-password"
              className={inputClass(darkMode)}
              id="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>
          <label className="block text-sm font-medium" htmlFor="new-password">
            New password
            <input
              autoComplete="new-password"
              className={inputClass(darkMode)}
              id="new-password"
              minLength={12}
              maxLength={128}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label
            className="block text-sm font-medium"
            htmlFor="confirm-password"
          >
            Confirm new password
            <input
              autoComplete="new-password"
              className={inputClass(darkMode)}
              id="confirm-password"
              minLength={12}
              maxLength={128}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          <button
            className={buttonClass}
            disabled={passwordSaving}
            type="submit"
          >
            {passwordSaving ? "Changing password…" : "Change password"}
          </button>
        </form>
        <button
          className="mt-5 rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-100"
          onClick={onLogout}
          type="button"
        >
          Sign out
        </button>
      </section>

      <section aria-labelledby="appearance-heading" className={panelClass}>
        <h2 className="text-lg font-semibold" id="appearance-heading">
          Appearance
        </h2>
        <fieldset className="mt-3 flex flex-wrap gap-4">
          <legend className="sr-only">Theme preference</legend>
          {themeOptions.map((option) => (
            <label
              className="flex items-center gap-2 text-sm"
              key={option.value}
            >
              <input
                checked={themePreference === option.value}
                name="theme-preference"
                onChange={() => onThemeChange(option.value)}
                type="radio"
                value={option.value}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="notifications-heading" className={panelClass}>
        <h2 className="text-lg font-semibold" id="notifications-heading">
          Notifications
        </h2>
        <p className="mt-1 text-sm opacity-65">
          Task reminders were removed and are not currently delivered. The
          reminder preference is stored, but enabling it does not schedule or
          send reminders. Email notifications are not supported.
        </p>
        <form className="mt-4 space-y-3" onSubmit={saveNotifications}>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={notificationPreferences.browserNotifications}
              onChange={(event) =>
                setNotificationPreferences((current) => ({
                  ...current,
                  browserNotifications: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Browser notification preference (no notifications are currently
            delivered)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={notificationPreferences.taskReminders}
              onChange={(event) =>
                setNotificationPreferences((current) => ({
                  ...current,
                  taskReminders: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Task reminder preference (delivery unavailable)
          </label>
          <button
            className={buttonClass}
            disabled={profileSaving}
            type="submit"
          >
            {profileSaving ? "Saving…" : "Save notification preferences"}
          </button>
        </form>
      </section>

      <section aria-labelledby="data-heading" className={panelClass}>
        <h2 className="text-lg font-semibold" id="data-heading">
          Data &amp; Privacy
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-100"
            onClick={() => onNavigate("trash")}
            type="button"
          >
            Open Trash
          </button>
        </div>
        <div className="mt-5">
          <BackupSettings darkMode={darkMode} />
        </div>
      </section>

      <section
        aria-labelledby="delete-account-heading"
        className={`rounded-2xl border p-5 sm:p-6 ${
          darkMode
            ? "border-red-950 bg-red-950/20"
            : "border-red-200 bg-red-50/60"
        }`}
      >
        <h2 className="text-lg font-semibold" id="delete-account-heading">
          Permanently delete account
        </h2>
        <p className="mt-1 text-sm opacity-75">
          This permanently removes your diary entries (including Trash), tasks,
          images, and backup import history. This action cannot be undone.
        </p>
        <form className="mt-4 max-w-xl space-y-4" onSubmit={submitDeletion}>
          <label
            className="block text-sm font-medium"
            htmlFor="delete-password"
          >
            Current password
            <input
              autoComplete="current-password"
              className={inputClass(darkMode)}
              id="delete-password"
              onChange={(event) => setDeletePassword(event.target.value)}
              required
              type="password"
              value={deletePassword}
            />
          </label>
          <label
            className="block text-sm font-medium"
            htmlFor="delete-confirmation"
          >
            Type DELETE to confirm
            <input
              className={inputClass(darkMode)}
              id="delete-confirmation"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              required
              value={deleteConfirmation}
            />
          </label>
          <button
            className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={deleting}
            type="submit"
          >
            {deleting ? "Deleting account…" : "Permanently delete account"}
          </button>
        </form>
      </section>
    </section>
  );
}
