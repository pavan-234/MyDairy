# MyDiary

A small personal diary app built with React, Express, and MongoDB. The frontend
and backend are separate, simple applications; the backend stores entries in
MongoDB Atlas and exposes a REST API.

## Project files

- `frontend/` — React interface, API calls, and Tailwind CSS.
- `backend/` — Express server, REST routes, controller functions, and Mongoose
  model/database connection.

Each diary entry has a `title`, `content`, `date`, `formatting`, `createdAt`,
`updatedAt`, `mood`, `tags`, `isFavorite`, `isDraft`, and `deletedAt`.
Mongoose supplies the timestamps automatically. New metadata fields have
defaults so existing entries remain readable without a destructive schema
migration.
`content` stores HTML for inline bold, italic, underline, and selected text
color. `formatting` stores the whole-entry font, font size, default text color,
alignment, page style, and light/dark theme. Moods are `HAPPY`, `GOOD`,
`NEUTRAL`, `SAD`, `ANGRY`, and `EXCITED`. Tags are trimmed, lowercased, and
deduplicated; an entry supports at most 10 tags of up to 24 characters each.
Drafts may have an empty title or content; published entries require both.
Deleted entries are retained with a `deletedAt` timestamp until explicitly
permanently deleted from Trash. Trash entries remain private to their owner and
retain their image attachments until permanent deletion.

## Set up MongoDB

For local development with MongoDB Atlas, create a cluster and database user,
allow your machine's IP to connect in Atlas Network Access, and copy
`backend/.env.example` to `backend/.env`. Replace the example URI with your
Atlas connection string. The backend accepts `MONGO_URI` (preferred) and the
older `MONGODB_URI` variable; without either, it connects to
`mongodb://localhost:27017/diary`. Keep the real `.env` file private; it is
ignored by Git.

## Authentication configuration

The API now requires an account for diary and task access. For local Docker
Compose, copy the root `.env.example` to `.env`, replace `JWT_SECRET` with a
random secret of at least 32 bytes, and keep `.env` private. Set `APP_ORIGIN` to
the exact browser origin and `COOKIE_SECURE=true` when serving over HTTPS
(`false` is only appropriate for loopback HTTP development such as
`http://localhost:5173`). The backend rejects plain HTTP origins on non-loopback
hosts. The Compose frontend port is also bound to host loopback, so it is not
directly reachable from other machines.

For direct backend development, configure the same variables in
`backend/.env`. The session is a 30-minute, HttpOnly, SameSite=Lax cookie.
Registration requires an email and a password of 12–128 characters. Passwords
are hashed with Argon2id. Login failures use a generic response; authentication
attempts are rate limited. Use HTTPS in deployed environments and configure
`APP_ORIGIN` to the public HTTPS origin with `COOKIE_SECURE=true`. Terminate TLS
at a trusted reverse proxy; do not expose the app through a separate public
HTTP listener.
In Docker Compose the backend port is bound to the host loopback interface; the
frontend Nginx container reaches it over the private Compose network.

Existing records have no owner field and are not automatically assigned to a
new account. Back up the database, create the account that should own those
records, then set `MIGRATION_OWNER_EMAIL` and run `npm run migrate:ownership`
from `backend/`. In PowerShell, for example:

```powershell
$env:MIGRATION_OWNER_EMAIL = "owner@example.com"
npm run migrate:ownership
```

For Docker Compose:

```powershell
docker compose exec -e MIGRATION_OWNER_EMAIL=owner@example.com backend npm run migrate:ownership
```

The migration assigns only records that have no owner and can be safely rerun.
Until migrated, unowned records are not visible through authenticated APIs.

Authentication endpoints:

- `POST /api/auth/register` — create an account and begin a session.
- `POST /api/auth/login` — authenticate and begin a session.
- `GET /api/auth/me` — return the current user; requires a valid session.
- `POST /api/auth/logout` — invalidate the current user’s tokens and clear the
  session cookie.

Profile and account settings endpoints:

- `GET /api/profile` — return the safe profile, account creation date, and saved
  notification preferences.
- `PATCH /api/profile` — update the display name and/or browser-notification
  and task-reminder preference flags. Email and protected account fields cannot
  be changed through this endpoint.
- `POST /api/profile/password` — require the current password, replace it with
  an Argon2id hash, invalidate previous sessions, and issue a replacement
  session cookie.
- `DELETE /api/profile` — permanently delete the authenticated account and its
  diary entries, Trash, tasks, attachments, and backup-import history. Requires
  the current password and `confirmation: "DELETE"`; cleanup failures leave the
  account pending deletion so it can be retried.

The appearance preference (`light`, `dark`, or `system`) is stored in browser
local storage. Notification preference flags are saved on the account, but task
reminder delivery and email notifications are currently unavailable; saving
these flags does not schedule or send notifications.

Diary and task endpoints require the session cookie. All record reads,
updates, and deletes are restricted to the authenticated owner.

Diary Trash endpoints:

- `DELETE /api/entries/:id` — move an active entry to Trash.
- `GET /api/entries/trash?page=1&limit=10&search=...` — list the current user's
  trashed entries with the normal entry filters and pagination.
- `POST /api/entries/trash/:id/restore` — restore a trashed entry.
- `DELETE /api/entries/trash/:id` — permanently delete a trashed entry and its
  image files. This action cannot be undone.

Active entry lists, search, calendar activity, streaks, and dashboard analytics
exclude Trash. A failed image-file cleanup leaves the entry in a pending purge
state so repeating its permanent-delete request can retry safely.

## Export and restore

Authenticated backup endpoints operate only on the current account:

- `GET /api/backup/export?format=json&includeTrash=true` — stream a restorable
  ZIP containing `manifest.json`, `data.json`, and WebP attachments.
- `GET /api/backup/export?format=csv&includeTrash=false` — stream a ZIP with
  entries, tasks, attachment metadata, and referenced WebP files. CSV exports
  are for spreadsheets and are not restorable.
- `GET /api/backup/export?format=pdf&includeTrash=true` — stream a printable
  report.
- `POST /api/backup/import/preview` — upload a JSON backup ZIP as multipart
  field `backup` and validate it without changing the account.
- `POST /api/backup/import` — upload the same archive with
  `X-Backup-Confirmed: true` to add its entries, tasks, and attachments to the
  signed-in account. It does not overwrite profile information or existing
  records. Each backup ID may be imported once per account.

Import accepts only the versioned JSON ZIP backup. Uploads are limited to
100 MB; archives may expand to 250 MB, contain up to 10,000 entries and 10,000
tasks, and include up to 5 MB per attachment. JSON backups include Trash by
default; set `includeTrash=false` to omit it. Backups contain only the
authenticated account's email/display name and diary/task data, never
credentials or authentication secrets.
Locked entries are omitted from JSON, CSV, and PDF exports by default. A JSON
backup can explicitly include locked entries by POSTing `format`, boolean
`includeTrash`, `includeLocked: true`, and the current password to
`/api/backup/export`; imported entries retain their locked status.

## Install and run

Use Node.js and npm. Open two terminals from the project root:

```sh
cd backend
npm install
npm run dev
```

In the second terminal:

```sh
cd frontend
npm install
npm run dev
```

Open the frontend URL printed by Vite (usually `http://localhost:5173`). Vite
forwards requests starting with `/api` to the Express server at
`http://localhost:5000`.

To make a production frontend build, run `npm run build` from `frontend/`.

## Run the complete app with Docker

Install Docker Desktop, then run this command from the project root:

```sh
docker compose up --build
```

Open `http://localhost:5173` in your browser. The React build is served by
Nginx, which forwards `/api` requests to the Express backend at
`http://localhost:5000`. In Compose, the backend connects to the MongoDB
service at `mongodb:27017`; the database is stored in a named volume so it
survives normal container recreation.

Useful commands:

```sh
docker compose up -d
docker compose ps
docker compose logs
docker compose down
```

`docker compose down` keeps the database volume. Avoid `docker compose down -v`
if you want to preserve diary data.

## Tests and code checks

The backend integration suite uses Node's built-in test runner and requires a
reachable MongoDB instance. By default it uses
`mongodb://127.0.0.1:27017/mydiary_auth_test`; set `TEST_MONGO_URI` to use a
different test database. The suite creates uniquely named test accounts and
removes their records and uploaded test images when it finishes.

Run backend tests and coverage from `backend/`:

```sh
npm test
npm run test:coverage
npm run lint
npm run format:check
```

Run frontend tests, lint, format verification, and the production build from
`frontend/`:

```sh
npm test
npm run test:coverage
npm run lint
npm run format:check
npm run build
```

`npm run format` in either package applies the repository Prettier style to
that package's source and tests. Frontend unit tests use Vitest, jsdom, and
React Testing Library. They cover authentication form behavior, auth API
requests/errors, unauthenticated redirects, expired-session handling, and
backup export/preview/restore UI states. Frontend coverage is scoped to selected
API clients and components; it does not measure the full application bundle.
Backend integration tests exercise MongoDB-backed authentication,
authorization, diary CRUD/search/filter/pagination/calendar/dashboard, tasks,
attachments, JSON/CSV/PDF exports, validated restore, duplicate-import
prevention, and common error/security paths. They verify cross-user record
isolation and attachment restoration. Set `TEST_REDIS_URL` alongside
`TEST_MONGO_URI` to run the integration suite against Redis as well. The suite
is not a substitute for browser end-to-end testing or production deployment
testing.

## GitHub Actions CI

The `.github/workflows/ci.yaml` workflow runs for pushes and pull requests
targeting `main`, and can also be started manually. Its single ordered job
checks out the repository, caches npm download data using both lockfiles,
installs each package with `npm ci`, runs both linters and format checks, runs
the backend integration suite against a disposable MongoDB service, runs the
frontend tests, builds the frontend, builds both Docker images, and validates
the Compose configuration. A failing stage stops the remaining steps. Runs for
the same branch or pull request are cancelled when a newer run starts.

CI does **not** deploy the application and does not need GitHub Actions secrets.
The backend integration tests use a disposable test database and test-only
configuration. Compose validation uses a non-production placeholder solely to
resolve required configuration variables; it is not used to run the application
or build an image. Do not add production credentials to this workflow. If
deployment is added later, store its credentials as narrowly scoped GitHub
Actions secrets and expose them only to the deployment job.

To run the same checks locally, ensure MongoDB is reachable at the test URI (or
set `TEST_MONGO_URI`) and run from the repository root:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm --prefix backend run lint
npm --prefix frontend run lint
npm --prefix backend run format:check
npm --prefix frontend run format:check
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run build
docker build --tag mydiary-backend:ci ./backend
docker build --tag mydiary-frontend:ci ./frontend
```

Compose validation also requires the three configuration values in the root
`.env` file; for local development, create it from `.env.example` as described
above, then run `docker compose config --quiet`.

## API

Diary endpoints use `/api/entries` and JSON request/response bodies. A valid
session is required, and each operation is restricted to the authenticated
owner. Responses include the entry metadata and Mongoose timestamps.

### Search and list entries

`GET /api/entries`

The list is scoped to the signed-in user, filtered and sorted in MongoDB, and
paginated before results are returned. Pagination defaults to `page=1` and
`limit=10`; `limit` cannot exceed 50 and offsets cannot exceed 100,000 entries.
If a requested page is past the end of the current result set, the API returns
the last available page.

Supported query parameters:

- `search` — up to 100 characters; full-text search across title and content
  (all normalized words must match; title matches are weighted more heavily).
- `mood` — one of `HAPPY`, `GOOD`, `NEUTRAL`, `SAD`, `ANGRY`, or `EXCITED`.
- `tags` — comma-separated tags; an entry must include every requested tag.
- `favorite` — `true` or `false`.
- `from`, `to` — inclusive `YYYY-MM-DD` entry-date bounds; combined ranges may
  span at most 10 years.
- `sort` — `createdAt` (default) or `updatedAt`.
- `order` — `asc` or `desc` (default); ties use the entry ID for stable order.
- `page`, `limit` — positive integers subject to the bounds above.

For example:

```text
GET /api/entries?page=1&limit=10&search=docker&mood=HAPPY&tags=work,journal&favorite=true&from=2026-10-01&to=2026-10-31&sort=updatedAt&order=desc
```

Example response (`200 OK`):

```json
{
  "data": [
    {
      "_id": "67d012345678901234567890",
      "title": "A good day",
      "content": "I went for a <strong>walk</strong>.",
      "date": "2026-10-07",
      "mood": "HAPPY",
      "tags": ["family", "weekend"],
      "isFavorite": true,
      "isDraft": false,
      "formatting": {
        "fontFamily": "Georgia",
        "fontSize": 18,
        "textColor": "#292524",
        "textAlign": "left",
        "pageStyle": "ruled",
        "theme": "light"
      },
      "createdAt": "2026-10-07T05:20:00.000Z",
      "updatedAt": "2026-10-07T05:20:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

Invalid or duplicate query parameters return `400 Bad Request`. A text index
on the owner's title and content fields supports bounded full-text discovery.

`GET /api/entries/calendar/activity?from=YYYY-MM-DD&to=YYYY-MM-DD` returns
published-entry counts grouped by date for the authenticated owner. The
inclusive range is limited to 366 calendar days. `GET
/api/entries/calendar/day?date=YYYY-MM-DD&page=1&limit=50` returns the
published entries for one date, in creation order, with database pagination
(maximum page size 50). These endpoints allow a month view and one selected day
to load without fetching the user's full diary. Drafts are excluded. The
previous `GET /api/entries/calendar/dates` endpoint remains available and
continues to return distinct published-entry dates.

Entry dates use a canonical `YYYY-MM-DD` calendar date, not a UTC timestamp.
When creating an entry, the frontend supplies its local timezone offset and
the backend saves that local date. Calendar queries compare those date strings
directly; streak day differences are calculated from date-only values using
UTC day boundaries, so daylight-saving transitions do not create or remove a
writing day. `GET /api/entries/streak?today=YYYY-MM-DD` uses the client's
current local date and returns the current and longest writing streak plus
whether an entry was written today. Multiple entries on one date count as one
streak day; drafts do not count toward activity or streaks.

### Personal dashboard

`GET /api/dashboard?today=YYYY-MM-DD&group=day`

The dashboard is calculated server-side in one user-scoped MongoDB aggregation.
`today` is the authenticated writer's local calendar date and is required.
`group` may be `day` (default), `week`, or `month`:

- `day` returns activity grouped by date for the last 30 days.
- `week` returns activity grouped by Monday-starting week for the last 12
  weeks.
- `month` returns activity grouped by calendar month for the last 12 months.

The response includes published-entry totals, favorites, this-week and
this-month counts, current and longest streaks, all controlled mood counts,
the eight most-used tags, activity buckets, and up to five recent and five
favorite entry summaries. Entry summaries omit diary content and owner IDs;
the frontend fetches the full entry only when the user opens one. All counts
and breakdowns are scoped to the session owner. Entries without a mood from
older schema versions are included in the `NEUTRAL` count. Drafts and locked
entries are excluded.
Activity and streak date math uses the canonical `YYYY-MM-DD` entry date,
avoiding UTC timestamp shifts and daylight-saving boundary errors.

### Get one entry

`GET /api/entries/:id`

Example: `GET /api/entries/67d012345678901234567890`

Returns the entry as above (`200 OK`), or `404 Not Found` if the ID does not
match an entry. Locked entries return `423 Locked` without private metadata or
content unless the owner has completed the short-lived unlock flow.

### Lock and unlock an entry

- `POST /api/entries/:id/lock` locks an active entry owned by the signed-in
  user. The response contains only a safe summary.
- `POST /api/entries/:id/unlock` accepts `{ "currentPassword": "..." }`.
  Correct account-password verification returns the entry with
  `Cache-Control: private, no-store` and sets an HttpOnly, entry-scoped
  unlock cookie valid for five minutes. Incorrect credentials return
  `401 Unauthorized`; unlock attempts are rate-limited.

Locked content and metadata are omitted from list and Trash responses,
full-text search, calendar data, dashboard analytics, and CSV/PDF exports.
List and Trash results may contain a minimal locked-entry shell so the owner
can identify its date and unlock it. Locking requires no new PIN or stored
secret; the app uses the account password already protected by Argon2id.
Unlock grants are invalidated by locking the entry again, changing the account
password, or logging out. This is an additional application-level verification
step, not encryption at rest: database operators with direct access can read
the stored entry fields.

### Create an entry

`POST /api/entries`

New entries are always dated today in the writer's local timezone. The
frontend sends its timezone offset so the backend can reject attempts to
backdate or future-date a new entry. The date is displayed but cannot be
changed in the editor.

Example request:

```json
{
  "title": "A good day",
  "content": "I went for a <strong>walk</strong>.",
  "date": "2026-10-07",
  "mood": "HAPPY",
  "tags": ["family", "weekend"],
  "isFavorite": true,
  "isDraft": false,
  "formatting": {
    "fontFamily": "Georgia",
    "fontSize": 18,
    "textColor": "#292524",
    "textAlign": "left",
    "pageStyle": "ruled",
    "theme": "light"
  }
}
```

Returns the saved entry, including its `_id`, metadata, and timestamps
(`201 Created`). Set `"isDraft": true` to save an incomplete draft. Content is
sanitized on the server to the editor's supported formatting.
If `date` is supplied, it must be today's date; otherwise the request returns
`400 Bad Request`. If `date` or `formatting` is omitted, they default to
today's date and the editor's default appearance.

### Update an entry

`PUT /api/entries/:id`

Example request to `PUT /api/entries/67d012345678901234567890`:

```json
{
  "title": "A better day",
  "content": "I went for a longer <em>walk</em>.",
  "date": "2026-10-07",
  "mood": "GOOD",
  "tags": ["walking"],
  "isFavorite": false,
  "isDraft": false,
  "formatting": {
    "fontFamily": "Arial",
    "fontSize": 20,
    "textColor": "#292524",
    "textAlign": "center",
    "pageStyle": "dotted",
    "theme": "dark"
  }
}
```

Updates may include any of `title`, `content`, `formatting`, `mood`, `tags`,
`isFavorite`, and `isDraft`. Returns the updated entry with the same shape as
the create response (`200 OK`),
or `404 Not Found` if the ID does not match an entry. An entry's date is
preserved when editing; Mongoose updates `updatedAt` automatically.

### Delete an entry

`DELETE /api/entries/:id`

Returns `200 OK` with:

```json
{
  "message": "Diary entry deleted successfully"
}
```

Returns `404 Not Found` if the ID does not match an entry.

## CRUD data flow

1. React reads the form fields and sends JSON using `fetch`.
2. Vite proxies `/api/entries` requests to Express during development.
3. Express routes the request to a controller function.
4. The controller reads or writes a `DiaryEntry` document through Mongoose.
5. MongoDB Atlas returns the saved/fetched document; Express sends it back as
   JSON.
6. React uses the response to update the entry list and selected entry.

Creating uses `POST`, reading uses `GET`, editing uses `PUT`, and deleting uses
`DELETE`. The frontend loads the list when the page opens, fetches an individual
entry when selected, and updates its display after a successful save or delete.

## Daily tasks

Tasks remain in the existing per-user task collection and preserve the legacy
`date` and `completed` fields. `dueDate` is the canonical `YYYY-MM-DD` local
calendar date; the API also returns it as `date` for older clients. Status is
one of `TODO`, `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`; priorities are
`LOW`, `MEDIUM`, or `HIGH`. Older tasks without these fields are returned with
compatible defaults derived from `completed`.

- `GET /api/tasks` — legacy array response of the signed-in user's tasks.
- `GET /api/tasks?date=2026-10-07` — legacy array response for one due date.
- `GET /api/tasks?page=1&limit=50&status=TODO&priority=HIGH&from=2026-10-01&to=2026-10-31&search=study`
  — filtered, database-paginated response with `{ data, pagination }`.
  Status, priority, recurrence, due date range, and text search filters are
  optional; limits are capped at 100.
- `POST /api/tasks` — create a task, for example:

  ```json
  {
    "text": "Study DSA",
    "dueDate": "2026-10-08",
    "priority": "HIGH",
    "recurrence": "WEEKLY"
  }
  ```

- `PATCH /api/tasks/:id` — edit task fields or set status, for example
  `{ "text": "Review DSA", "priority": "MEDIUM", "dueDate": "2026-10-09" }`
  or `{ "status": "COMPLETED" }`. The legacy
  `{ "completed": true|false }` field remains supported and synchronized with
  status.
- `DELETE /api/tasks/:id` — delete a task.

Recurring tasks can repeat `DAILY`, `WEEKLY`, or `MONTHLY`. Only completing an
occurrence creates its next occurrence. A unique owner-scoped recurrence key
ensures retries or concurrent completion requests cannot create duplicate
occurrences. Monthly dates are clamped to the last valid day (for example,
January 31 advances to February 28, or February 29 in a leap year). Cancelling
an occurrence does not create the next one.

After changing app code in Docker Compose, rebuild and restart the app with
`docker compose up -d --build`.

The task dashboard provides create/edit/delete controls, completion and status
updates, priority and due-date indicators, overdue styling, filters, and
pagination. All task APIs scope reads and mutations to the authenticated user.

## Diary images

Diary entries can have up to five attached images. Uploads are sent as
`multipart/form-data` using the `image` field to
`POST /api/entries/:entryId/images`. The upload, image read, and image delete
routes all require authentication and verify ownership of the diary entry.
Image reads use
`GET /api/entries/:entryId/images/:imageId`; deletion uses
`DELETE /api/entries/:entryId/images/:imageId`.

JPEG, PNG, and WebP input is accepted, up to 5 MB per image. The backend
validates the actual image format, decodes and re-encodes images as WebP,
removes original metadata, and caps decoded dimensions. MongoDB stores only
the generated image ID, safe original display name, WebP MIME type, byte
size, dimensions, and upload timestamp. Image bytes live in a private local
directory (default `backend/uploads`, configurable with `UPLOAD_DIR`). Docker
Compose persists them in the `diary-uploads` named volume. Back up this volume
alongside MongoDB data. Deleting an image or entry removes its stored image
files; image URLs are private and are not cached publicly.

The diary editor previews selected images, supports removal, and displays
saved images while reading entries. If an image operation fails after an entry
was saved, the UI keeps the entry and reports the image error so the user can
retry. AI image analysis is not implemented.

## Read caching and query performance

The backend uses Redis only as an optional cache for authenticated dashboard
responses and calendar date/activity summaries for ranges of up to 31 days.
Dashboard entries expire after 30 seconds; calendar summaries expire after
120 seconds. Cache keys include the authenticated user ID, a per-user cache
generation, and normalized query parameters. Creating, editing, or deleting an
entry (including image changes that update entry timestamps) advances that
user's generation. If Redis is unavailable or a cache operation times out, the
request falls back to MongoDB and the application continues normally. Cache
data is disposable; Compose runs Redis without persistence and bounds it to
128 MB with LRU eviction. Compose does not publish Redis's port.

Compose configures `REDIS_URL=redis://redis:6379`. For direct backend
development Redis is optional; set `REDIS_URL` only if a local Redis instance
is available. The existing owner/date and owner/created/updated indexes support
calendar range reads, diary pagination, and the dashboard's ordered scan.
List APIs remain database-paginated with bounded page sizes; the dashboard
uses a single aggregation and returns bounded recent/favorite lists. Entry
search is intentionally not cached because its query space is user-generated
and highly variable.

## Editor appearance

The editor uses the browser's built-in editable text area and formatting
commands, without an added rich-text editor dependency. Inline formatting is
saved in the entry's `content` HTML. Whole-entry appearance is saved in its
`formatting` object and sent with create/update requests. Reopening an entry
uses both fields to restore the text and appearance. The frontend sanitizes
stored content to a small set of formatting tags before displaying or editing
it.

Use **Download** on an opened diary entry to save its current title, date, and
plain-text content as `diary-YYYY-MM-DD.txt`.

## Calendar

Choose **Calendar** in the sidebar to browse months. Dates with diary entries
show a 🔥 marker, while past dates without an entry show 😢; today is outlined
and labeled separately. The monthly overview summarizes writing days, quiet
days, and your writing rhythm so far. Selecting a date lists its entries, which
can be opened in the editor. Use **Today** to return to the current date.

## Browse and search diary entries

Choose **All Entries** in the sidebar to open the diary archive. Entries are
grouped by date, newest first, and can be opened from their preview cards. Use
the search field on this dashboard to immediately filter by title or content.
Search ignores letter case and works with formatted entry text; the sidebar
stays focused on navigation, writing streaks, and today's tasks.
