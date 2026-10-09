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

export default function HomePage({ darkMode, onNavigate, onToggleTheme }) {
  return (
    <main
      className={`min-h-screen overflow-hidden transition-colors ${
        darkMode ? "bg-[#101713] text-stone-100" : "bg-[#f7f7f2] text-stone-900"
      }`}
    >
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Brand darkMode={darkMode} />
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-2 sm:gap-3"
        >
          <ThemeToggle darkMode={darkMode} onToggleTheme={onToggleTheme} />
          <button
            className={`hidden rounded-full px-4 py-2.5 text-sm font-semibold transition sm:inline-flex ${
              darkMode
                ? "text-stone-300 hover:bg-white/5"
                : "text-stone-600 hover:bg-black/5"
            }`}
            onClick={() => onNavigate("/login")}
            type="button"
          >
            Sign in
          </button>
          <button
            className="rounded-full bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900 sm:px-5"
            onClick={() => onNavigate("/register")}
            type="button"
          >
            Get started
          </button>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-10 sm:px-8 sm:pb-24 lg:grid-cols-[1.03fr_0.97fr] lg:gap-8 lg:px-12 lg:pb-28 lg:pt-14">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -right-52 top-8 size-[34rem] rounded-full blur-3xl ${
            darkMode ? "bg-emerald-900/20" : "bg-emerald-200/35"
          }`}
        />
        <div className="relative z-10 max-w-2xl">
          <p
            className={`mb-6 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
              darkMode
                ? "border-emerald-900/70 bg-emerald-950/40 text-emerald-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-emerald-500"
            />
            A little space for you
          </p>
          <h1 className="text-[3.5rem] font-medium leading-[0.98] tracking-[-0.065em] sm:text-7xl lg:text-[5.6rem]">
            Make room
            <br />
            for <span className="font-serif italic text-emerald-700">you.</span>
          </h1>
          <p
            className={`mt-7 max-w-lg text-base leading-7 sm:text-lg sm:leading-8 ${
              darkMode ? "text-stone-400" : "text-stone-600"
            }`}
          >
            Your days deserve more than a passing thought. Capture the moments,
            find your rhythm, and make sense of it all—one page at a time.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              className="group inline-flex items-center gap-3 rounded-full bg-emerald-800 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-emerald-950/10 transition hover:-translate-y-0.5 hover:bg-emerald-900"
              onClick={() => onNavigate("/register")}
              type="button"
            >
              Start your journal
              <span
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-1"
              >
                →
              </span>
            </button>
            <button
              className={`rounded-full px-5 py-3.5 text-sm font-semibold transition ${
                darkMode
                  ? "text-stone-300 hover:bg-white/5"
                  : "text-stone-600 hover:bg-black/5"
              }`}
              onClick={() => onNavigate("/login")}
              type="button"
            >
              I already have an account
            </button>
          </div>
          <div
            className={`mt-12 flex items-center gap-4 border-t pt-6 ${
              darkMode ? "border-white/10" : "border-stone-200"
            }`}
          >
            <div className="flex -space-x-2" aria-hidden="true">
              {["bg-[#d6a47f]", "bg-[#9eb4a0]", "bg-[#d7c1a4]"].map((color) => (
                <span
                  className={`grid size-8 place-items-center rounded-full border-2 text-xs text-white ${color} ${
                    darkMode ? "border-[#101713]" : "border-[#f7f7f2]"
                  }`}
                  key={color}
                >
                  ✦
                </span>
              ))}
            </div>
            <p
              className={`text-sm ${
                darkMode ? "text-stone-400" : "text-stone-500"
              }`}
            >
              A private place to check in with yourself.
            </p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[34rem] py-5 lg:py-12">
          <div
            aria-hidden="true"
            className={`absolute -right-2 top-4 size-24 rounded-full border ${
              darkMode ? "border-emerald-900/70" : "border-emerald-200"
            }`}
          />
          <div
            aria-hidden="true"
            className={`absolute -bottom-2 left-0 size-32 rounded-full blur-2xl ${
              darkMode ? "bg-amber-800/15" : "bg-amber-200/50"
            }`}
          />
          <article
            className={`relative rotate-[-2deg] rounded-[2rem] border p-5 shadow-2xl transition-transform duration-500 hover:rotate-0 sm:p-7 ${
              darkMode
                ? "border-white/10 bg-[#19221c] shadow-black/30"
                : "border-white bg-white shadow-stone-900/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Tuesday, October 8
                </p>
                <p
                  className={`mt-1 text-sm ${
                    darkMode ? "text-stone-500" : "text-stone-400"
                  }`}
                >
                  A note to myself
                </p>
              </div>
              <span
                className={`grid size-11 place-items-center rounded-2xl text-xl ${
                  darkMode ? "bg-amber-950/70" : "bg-amber-50"
                }`}
                aria-label="Sunny mood"
                role="img"
              >
                ☀
              </span>
            </div>
            <div
              className={`mt-6 border-t pt-6 ${
                darkMode ? "border-white/10" : "border-stone-100"
              }`}
            >
              <h2 className="font-serif text-3xl leading-tight sm:text-4xl">
                The small things
                <br />
                are the big things.
              </h2>
              <p
                className={`mt-5 text-sm leading-7 sm:text-base ${
                  darkMode ? "text-stone-400" : "text-stone-600"
                }`}
              >
                A slow morning. Coffee before it gets cold. A message from an
                old friend. Today I remembered that a good life is built from
                moments like these.
              </p>
              <div
                className={`mt-7 flex items-center justify-between rounded-2xl px-4 py-3 ${
                  darkMode ? "bg-white/5" : "bg-[#f8f7f2]"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden="true">🔥</span> Your writing streak
                </span>
                <span className="font-semibold text-emerald-700">7 days</span>
              </div>
            </div>
          </article>
          <div
            className={`absolute -bottom-1 -left-3 rounded-2xl border px-4 py-3 shadow-xl sm:-left-8 ${
              darkMode
                ? "border-white/10 bg-[#202b23] shadow-black/20"
                : "border-white bg-white shadow-stone-900/10"
            }`}
          >
            <p
              className={`text-xs ${
                darkMode ? "text-stone-500" : "text-stone-400"
              }`}
            >
              THIS WEEK
            </p>
            <div
              className="mt-2 flex items-end gap-1.5"
              aria-label="Five days of writing"
            >
              {[35, 58, 44, 78, 55, 90, 48].map((height, index) => (
                <span
                  className={`w-2.5 rounded-full ${
                    index === 5
                      ? "bg-emerald-600"
                      : darkMode
                        ? "bg-emerald-900"
                        : "bg-emerald-200"
                  }`}
                  key={height + index}
                  style={{ height: `${height * 0.34}px` }}
                />
              ))}
            </div>
          </div>
          <div
            className={`absolute -right-1 bottom-20 rounded-full border px-4 py-2.5 text-xs font-medium shadow-lg sm:-right-7 ${
              darkMode
                ? "border-white/10 bg-[#202b23] text-stone-300"
                : "border-white bg-white text-stone-600"
            }`}
          >
            ✦ Just for you. Always private.
          </div>
        </div>
      </section>

      <section
        className={`border-t ${
          darkMode
            ? "border-white/10 bg-[#141c17]"
            : "border-stone-200 bg-white/60"
        }`}
      >
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8 lg:px-12">
          {[
            [
              "01",
              "Write freely",
              "A calm, personal page for whatever is on your mind.",
            ],
            [
              "02",
              "Notice your patterns",
              "See your entries, moods, and writing streaks take shape.",
            ],
            [
              "03",
              "Keep it yours",
              "Your journal is private, with a space that feels like you.",
            ],
          ].map(([number, title, description]) => (
            <article className="flex gap-4" key={number}>
              <span className="font-serif text-sm italic text-emerald-700">
                {number}
              </span>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p
                  className={`mt-1 text-sm leading-6 ${
                    darkMode ? "text-stone-400" : "text-stone-500"
                  }`}
                >
                  {description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer
        className={`mx-auto flex max-w-7xl items-center justify-between px-5 py-6 text-xs sm:px-8 lg:px-12 ${
          darkMode ? "text-stone-500" : "text-stone-400"
        }`}
      >
        <Brand darkMode={darkMode} />
        <span>A softer place to land at the end of the day.</span>
      </footer>
    </main>
  );
}
