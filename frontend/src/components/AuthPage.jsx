function ThemeToggle({ darkMode, onToggleTheme }) {
  return (
    <button
      aria-label={`Switch to ${darkMode ? "light" : "dark"} theme`}
      className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
        darkMode
          ? "border-white/10 bg-white/5 text-stone-200 hover:bg-white/10"
          : "border-stone-200 bg-white/70 text-stone-700 hover:bg-white"
      }`}
      onClick={onToggleTheme}
      type="button"
    >
      <span aria-hidden="true">{darkMode ? "☀" : "☾"}</span>
      <span>{darkMode ? "Light" : "Dark"}</span>
    </button>
  );
}

function Brand({ darkMode }) {
  return (
    <span className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-2xl bg-emerald-800 text-lg text-white shadow-lg shadow-emerald-950/10">
        <span aria-hidden="true">✳</span>
      </span>
      <span
        className={`text-lg font-semibold tracking-tight ${
          darkMode ? "text-white" : "text-stone-900"
        }`}
      >
        MyDiary
      </span>
    </span>
  );
}

export default function AuthPage({
  mode,
  error,
  busy,
  darkMode,
  onSubmit,
  onNavigate,
  onToggleTheme,
}) {
  const isRegistering = mode === "register";

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    onSubmit({
      email: formData.get("email"),
      password: formData.get("password"),
      displayName: formData.get("displayName") || "",
    });
  }

  const mutedText = darkMode ? "text-stone-400" : "text-stone-500";
  const inputClass = `mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-700/10 ${
    darkMode
      ? "border-white/10 bg-[#111813] text-stone-100 placeholder:text-stone-600"
      : "border-stone-200 bg-[#fbfbf8] text-stone-900 placeholder:text-stone-400"
  }`;

  return (
    <main
      className={`min-h-screen transition-colors ${
        darkMode ? "bg-[#101713] text-stone-100" : "bg-[#f7f7f2] text-stone-900"
      }`}
    >
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <button
          aria-label="Go to MyDiary home"
          className="rounded-xl"
          onClick={() => onNavigate("/")}
          type="button"
        >
          <Brand darkMode={darkMode} />
        </button>
        <div className="flex items-center">
          <ThemeToggle darkMode={darkMode} onToggleTheme={onToggleTheme} />
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-10 px-5 pb-12 pt-4 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-12 lg:pb-16">
        <div className="relative hidden min-h-[620px] overflow-hidden rounded-[2rem] bg-[#173c2a] p-10 text-white shadow-2xl shadow-emerald-950/10 lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div
            aria-hidden="true"
            className="absolute -right-28 -top-28 size-[28rem] rounded-full border border-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute -right-8 -top-8 size-[20rem] rounded-full border border-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-28 -left-20 size-80 rounded-full bg-emerald-400/10 blur-2xl"
          />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
              Your own little corner
            </p>
            <h1 className="mt-7 max-w-lg text-5xl font-medium leading-[1.05] tracking-[-0.05em] xl:text-6xl">
              {isRegistering ? (
                <>
                  Begin where
                  <br />
                  <span className="font-serif italic text-[#c3d7b6]">
                    you are.
                  </span>
                </>
              ) : (
                <>
                  Come back
                  <br />
                  <span className="font-serif italic text-[#c3d7b6]">
                    to yourself.
                  </span>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-emerald-50/70">
              A few honest words can change the way a day feels. Your space is
              ready whenever you are.
            </p>
          </div>

          <div className="relative rounded-3xl border border-white/10 bg-white/[0.07] p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-100/60">
                  A gentle reminder
                </p>
                <p className="mt-3 font-serif text-2xl">
                  “You can begin again.”
                </p>
              </div>
              <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-xl">
                ✦
              </span>
            </div>
            <div className="mt-6 flex items-center gap-2">
              <span className="h-1.5 w-8 rounded-full bg-emerald-200" />
              <span className="h-1.5 w-3 rounded-full bg-white/25" />
              <span className="h-1.5 w-3 rounded-full bg-white/25" />
            </div>
          </div>
          <p className="relative text-xs text-emerald-50/50">
            Private by nature. Yours by design.
          </p>
        </div>

        <div className="mx-auto w-full max-w-md py-6 lg:py-12">
          <div className="mb-8 lg:hidden">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Your own little corner
            </p>
            <p className="mt-3 font-serif text-3xl">
              {isRegistering
                ? "Begin where you are."
                : "Come back to yourself."}
            </p>
          </div>
          <div className="mb-8">
            <p className="text-sm font-semibold text-emerald-700">
              {isRegistering ? "A fresh page awaits" : "Your pages are waiting"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {isRegistering ? "Create your account" : "Welcome back"}
            </h2>
            <p className={`mt-3 text-sm leading-6 ${mutedText}`}>
              {isRegistering
                ? "Set up your private journal and start making space for the moments that matter."
                : "Sign in to pick up where you left off."}
            </p>
          </div>

          {error && (
            <p
              className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
                darkMode
                  ? "border-red-900/70 bg-red-950/40 text-red-200"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
              role="alert"
            >
              {error}
            </p>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {isRegistering && (
              <label className="block text-sm font-medium">
                Display name{" "}
                <span className={`font-normal ${mutedText}`}>(optional)</span>
                <input
                  autoComplete="name"
                  className={inputClass}
                  maxLength={80}
                  name="displayName"
                  placeholder="What should we call you?"
                />
              </label>
            )}
            <label className="block text-sm font-medium">
              Email
              <input
                autoComplete="email"
                className={inputClass}
                maxLength={254}
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                autoComplete={
                  isRegistering ? "new-password" : "current-password"
                }
                className={inputClass}
                maxLength={128}
                minLength={isRegistering ? 12 : undefined}
                name="password"
                placeholder={
                  isRegistering ? "At least 12 characters" : "Your password"
                }
                required
                type="password"
              />
            </label>
            <button
              className="group flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-800 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy
                ? "Please wait..."
                : isRegistering
                  ? "Create account"
                  : "Sign in"}
              {!busy && (
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              )}
            </button>
          </form>

          <p className={`mt-6 text-center text-xs leading-5 ${mutedText}`}>
            Your journal is personal. We’ll never share your entries.
          </p>
          <p className={`mt-8 text-center text-sm ${mutedText}`}>
            {isRegistering ? "Already have an account?" : "New to MyDiary?"}{" "}
            <button
              className="font-semibold text-emerald-700 transition hover:text-emerald-900"
              onClick={() => onNavigate(isRegistering ? "/login" : "/register")}
              type="button"
            >
              {isRegistering ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
