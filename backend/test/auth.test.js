import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import sharp from "sharp";
import unzipper from "unzipper";
import { after, before, test } from "node:test";

process.env.JWT_SECRET ||= randomBytes(32).toString("base64url");
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
const testRedisUrl = process.env.TEST_REDIS_URL;
process.env.REDIS_URL = testRedisUrl || "redis://127.0.0.1:1";

const [
  { default: mongoose },
  { default: jwt },
  { createApp },
  { default: User },
  { default: DiaryEntry },
  { default: DailyTask },
  { default: BackupImport },
  { tokenAudience, tokenIssuer },
] = await Promise.all([
  import("mongoose"),
  import("jsonwebtoken"),
  import("../src/app.js"),
  import("../src/models/User.js"),
  import("../src/models/DiaryEntry.js"),
  import("../src/models/DailyTask.js"),
  import("../src/models/BackupImport.js"),
  import("../src/config/auth.js"),
]);
const { deleteEntryImages } =
  await import("../src/controllers/imageController.js");
const { imageFilePath } = await import("../src/services/imageStorage.js");
const { getAuthConfig } = await import("../src/config/auth.js");
const { connectReadCache, disconnectReadCache } =
  await import("../src/services/readCache.js");

const mongoUri =
  process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017/mydiary_auth_test";
const origin = process.env.APP_ORIGIN;
const emailSuffix = `${Date.now()}-${randomBytes(5).toString("hex")}`;
const emailA = `phase1-a-${emailSuffix}@example.test`;
const emailB = `phase1-b-${emailSuffix}@example.test`;
const emailC = `phase1-c-${emailSuffix}@example.test`;
const emailD = `phase1-d-${emailSuffix}@example.test`;
const emailE = `phase14-e-${emailSuffix}@example.test`;
const emailF = `phase14-f-${emailSuffix}@example.test`;
const emailG = `phase15-g-${emailSuffix}@example.test`;
const emailH = `phase15-h-${emailSuffix}@example.test`;
const password = "a secure test passphrase";
let server;
let baseUrl;

before(async () => {
  if (testRedisUrl) await connectReadCache();
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.init(), DiaryEntry.init(), DailyTask.init()]);
  server = await new Promise((resolve, reject) => {
    const listeningServer = createApp().listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });
    listeningServer.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  const users = await User.find({
    email: {
      $in: [emailA, emailB, emailC, emailD, emailE, emailF, emailG, emailH],
    },
  }).select("_id");
  const userIds = users.map((user) => user._id);
  const entries = await DiaryEntry.find({ userId: { $in: userIds } });
  await Promise.all(entries.map((entry) => deleteEntryImages(entry)));
  await Promise.all([
    DiaryEntry.deleteMany({ userId: { $in: userIds } }),
    DailyTask.deleteMany({ userId: { $in: userIds } }),
    BackupImport.deleteMany({ userId: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
  await disconnectReadCache();
  await mongoose.disconnect();
});

async function request(
  path,
  { method = "GET", body, cookie, requestOrigin = origin, requestIp } = {}
) {
  const headers = { Origin: requestOrigin };
  if (requestIp) headers["X-Forwarded-For"] = requestIp;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function uploadRequest(
  path,
  { cookie, buffer, filename, mimeType } = {}
) {
  const form = new FormData();
  if (buffer) {
    form.append("image", new Blob([buffer], { type: mimeType }), filename);
  }
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
}

async function backupUploadRequest(
  path,
  { cookie, buffer, filename = "backup.zip", confirmed = false } = {}
) {
  const form = new FormData();
  if (buffer) {
    form.append(
      "backup",
      new Blob([buffer], { type: "application/zip" }),
      filename
    );
  }
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (confirmed) headers["X-Backup-Confirmed"] = "true";
  return fetch(`${baseUrl}${path}`, { method: "POST", headers, body: form });
}

function readSessionCookie(response) {
  const cookieHeaders = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie"),
  ];
  const sessionCookie = cookieHeaders.find((value) =>
    value?.startsWith("mydiary_session=")
  );
  assert.ok(sessionCookie, "response should set the session cookie");
  return sessionCookie.split(";", 1)[0];
}

test("registration, login, ownership isolation, protected routes, and logout", async () => {
  const testSecret = "test-secret-with-at-least-32-bytes";
  for (const appOrigin of [
    "http://192.0.2.1",
    "http://diary.example.test",
    "http://10.0.0.8",
  ]) {
    assert.throws(
      () =>
        getAuthConfig({
          JWT_SECRET: testSecret,
          APP_ORIGIN: appOrigin,
          COOKIE_SECURE: "false",
        }),
      /HTTP APP_ORIGIN is allowed only for loopback development/
    );
  }
  for (const appOrigin of [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ]) {
    assert.equal(
      getAuthConfig({
        JWT_SECRET: testSecret,
        APP_ORIGIN: appOrigin,
        COOKIE_SECURE: "false",
      }).secureCookie,
      false
    );
  }
  assert.equal(
    getAuthConfig({
      JWT_SECRET: testSecret,
      APP_ORIGIN: "https://diary.example.test",
      COOKIE_SECURE: "true",
    }).secureCookie,
    true
  );
  assert.throws(
    () =>
      getAuthConfig({
        JWT_SECRET: testSecret,
        APP_ORIGIN: "https://diary.example.test",
        COOKIE_SECURE: "false",
      }),
    /COOKIE_SECURE must match the APP_ORIGIN protocol/
  );

  const unauthenticated = await request("/api/entries");
  assert.equal(unauthenticated.status, 401);
  assert.equal((await request("/api/tasks")).status, 401);
  assert.equal((await request("/api/dashboard?today=2026-10-08")).status, 401);
  assert.equal(
    (
      await request("/api/auth/login", {
        method: "POST",
        requestOrigin: "http://attacker.example.test",
        body: { email: emailA, password },
      })
    ).status,
    403
  );

  const weakPassword = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailA, password: "too short" },
  });
  assert.equal(weakPassword.status, 400);

  const registeredA = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailA, password, displayName: "User A" },
  });
  assert.equal(registeredA.status, 201);
  const registeredAData = await registeredA.json();
  assert.equal(registeredAData.user.email, emailA);
  assert.equal("passwordHash" in registeredAData.user, false);
  assert.equal("password" in registeredAData.user, false);
  const cookieA = readSessionCookie(registeredA);
  const invalidMood = await request("/api/entries", {
    method: "POST",
    cookie: cookieA,
    body: { title: "Invalid", content: "Entry", mood: "SUSPICIOUS" },
  });
  assert.equal(invalidMood.status, 400);
  const userA = await User.findOne({ email: emailA }).select(
    "+passwordHash +tokenVersion"
  );
  assert.ok(userA.passwordHash);
  assert.notEqual(userA.passwordHash, password);

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailA, password },
  });
  assert.equal(duplicate.status, 409);

  const badLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: emailA, password: "incorrect passphrase" },
  });
  assert.equal(badLogin.status, 401);
  assert.equal((await badLogin.json()).message, "Invalid email or password");

  const loginA = await request("/api/auth/login", {
    method: "POST",
    body: { email: emailA, password },
  });
  assert.equal(loginA.status, 200);
  const cookieLoginA = readSessionCookie(loginA);

  const today = new Date().toISOString().slice(0, 10);
  const entryAResponse = await request("/api/entries", {
    method: "POST",
    cookie: cookieA,
    body: { title: "A private entry", content: "Only user A", date: today },
  });
  assert.equal(entryAResponse.status, 201);
  const entryA = await entryAResponse.json();
  assert.equal(String(entryA.userId), String(userA._id));
  assert.equal(entryA.mood, "NEUTRAL");
  assert.deepEqual(entryA.tags, []);
  assert.equal(entryA.isFavorite, false);
  assert.equal(entryA.isDraft, false);
  assert.ok(entryA.createdAt);
  assert.ok(entryA.updatedAt);

  const imageBuffer = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: 20, g: 130, b: 90 },
    },
  })
    .png()
    .toBuffer();
  const invalidImage = await uploadRequest(
    `/api/entries/${entryA._id}/images`,
    {
      cookie: cookieA,
      buffer: Buffer.from("not an image"),
      filename: "photo.jpg",
      mimeType: "image/jpeg",
    }
  );
  assert.equal(invalidImage.status, 400);

  const uploadedImageResponse = await uploadRequest(
    `/api/entries/${entryA._id}/images`,
    {
      cookie: cookieA,
      buffer: imageBuffer,
      filename: "../../memory.png",
      mimeType: "image/png",
    }
  );
  assert.equal(uploadedImageResponse.status, 201);
  const { attachment } = await uploadedImageResponse.json();
  assert.equal(attachment.originalName, "memory.png");
  assert.equal(attachment.mimeType, "image/webp");
  assert.equal(attachment.width, 8);
  assert.equal(attachment.height, 6);
  const imageIds = [attachment.id];
  const mismatchedImageMime = await uploadRequest(
    `/api/entries/${entryA._id}/images`,
    {
      cookie: cookieA,
      buffer: imageBuffer,
      filename: "misleading.jpg",
      mimeType: "image/jpeg",
    }
  );
  assert.equal(mismatchedImageMime.status, 400);
  const oversizedImage = await uploadRequest(
    `/api/entries/${entryA._id}/images`,
    {
      cookie: cookieA,
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      filename: "too-large.png",
      mimeType: "image/png",
    }
  );
  assert.equal(oversizedImage.status, 413);
  for (let index = 0; index < 4; index += 1) {
    const extraImage = await uploadRequest(
      `/api/entries/${entryA._id}/images`,
      {
        cookie: cookieA,
        buffer: imageBuffer,
        filename: `extra-${index}.png`,
        mimeType: "image/png",
      }
    );
    assert.equal(extraImage.status, 201);
    imageIds.push((await extraImage.json()).attachment.id);
  }
  const tooManyImages = await uploadRequest(
    `/api/entries/${entryA._id}/images`,
    {
      cookie: cookieA,
      buffer: imageBuffer,
      filename: "sixth.png",
      mimeType: "image/png",
    }
  );
  assert.equal(tooManyImages.status, 400);
  const loadedImage = await request(
    `/api/entries/${entryA._id}/images/${attachment.id}`,
    { cookie: cookieA }
  );
  assert.equal(loadedImage.status, 200);
  assert.equal(loadedImage.headers.get("content-type"), "image/webp");
  assert.ok((await loadedImage.arrayBuffer()).byteLength > 0);
  assert.equal(
    (
      await (
        await request(`/api/entries/${entryA._id}`, { cookie: cookieA })
      ).json()
    ).images.length,
    5
  );

  const taskAResponse = await request("/api/tasks", {
    method: "POST",
    cookie: cookieA,
    body: { text: "A private task", date: today },
  });
  assert.equal(taskAResponse.status, 201);
  const taskA = await taskAResponse.json();
  assert.equal(String(taskA.userId), String(userA._id));

  assert.equal(
    (
      await request(`/api/entries/${entryA._id}`, {
        cookie: cookieA,
      })
    ).status,
    200
  );
  const updatedEntryResponse = await request(`/api/entries/${entryA._id}`, {
    method: "PUT",
    cookie: cookieA,
    body: {
      title: "Updated entry",
      content:
        "<p>Safe <strong>rich text</strong><script>alert(1)</script></p>",
      mood: "EXCITED",
      tags: ["  Family ", "family", "Journal"],
      isFavorite: true,
      isDraft: false,
    },
  });
  assert.equal(updatedEntryResponse.status, 200);
  const updatedEntry = await updatedEntryResponse.json();
  assert.equal(updatedEntry.title, "Updated entry");
  assert.equal(updatedEntry.mood, "EXCITED");
  assert.deepEqual(updatedEntry.tags, ["family", "journal"]);
  assert.equal(updatedEntry.isFavorite, true);
  assert.equal(updatedEntry.isDraft, false);
  assert.match(updatedEntry.content, /<strong>rich text<\/strong>/);
  assert.doesNotMatch(updatedEntry.content, /<script/i);
  assert.ok(new Date(updatedEntry.updatedAt) >= new Date(entryA.updatedAt));

  const draftResponse = await request("/api/entries", {
    method: "POST",
    cookie: cookieA,
    body: { isDraft: true, mood: "GOOD" },
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(draft.isDraft, true);
  assert.equal(draft.title, "");
  assert.equal(draft.content, "");

  const entriesAResponse = await request("/api/entries", { cookie: cookieA });
  assert.equal(entriesAResponse.status, 200);
  const entriesA = await entriesAResponse.json();
  assert.deepEqual(
    entriesA.data.map((entry) => entry._id).sort(),
    [entryA._id, draft._id].sort()
  );
  assert.deepEqual(entriesA.pagination, {
    page: 1,
    limit: 10,
    total: 2,
    totalPages: 1,
  });
  assert.equal(
    (
      await request(`/api/entries/${draft._id}`, {
        method: "PUT",
        cookie: cookieA,
        body: {
          title: "Finished draft",
          content: "Now published",
          isDraft: false,
        },
      })
    ).status,
    200
  );

  const invalidTags = await request("/api/entries", {
    method: "POST",
    cookie: cookieA,
    body: {
      title: "Too many tags",
      content: "Entry",
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
    },
  });
  assert.equal(invalidTags.status, 400);

  const invalidFavorite = await request(`/api/entries/${entryA._id}`, {
    method: "PUT",
    cookie: cookieA,
    body: { isFavorite: "yes" },
  });
  assert.equal(invalidFavorite.status, 400);

  const titleSearch = await request(
    "/api/entries?search=Updated%20entry&page=1&limit=1",
    { cookie: cookieA }
  );
  const titleSearchData = await titleSearch.json();
  assert.equal(titleSearch.status, 200);
  assert.deepEqual(titleSearchData.pagination, {
    page: 1,
    limit: 1,
    total: 1,
    totalPages: 1,
  });
  assert.equal(titleSearchData.data[0]._id, entryA._id);
  const clampedPage = await request("/api/entries?page=50&limit=1", {
    cookie: cookieA,
  });
  const clampedPageData = await clampedPage.json();
  assert.equal(clampedPageData.pagination.page, 2);
  assert.equal(clampedPageData.data.length, 1);

  const contentSearch = await request("/api/entries?search=rich", {
    cookie: cookieA,
  });
  assert.deepEqual(
    (await contentSearch.json()).data.map((entry) => entry._id),
    [entryA._id]
  );

  const combinedFilter = await request(
    `/api/entries?mood=EXCITED&tags=family,journal&favorite=true&from=${today}&to=${today}`,
    { cookie: cookieA }
  );
  const combinedFilterData = await combinedFilter.json();
  assert.equal(combinedFilter.status, 200);
  assert.equal(combinedFilterData.pagination.total, 1);
  assert.equal(combinedFilterData.data[0]._id, entryA._id);

  const updatedSort = await request(
    "/api/entries?sort=updatedAt&order=asc&limit=1",
    { cookie: cookieA }
  );
  assert.equal(updatedSort.status, 200);
  assert.equal((await updatedSort.json()).data[0]._id, entryA._id);
  const createdSort = await request(
    "/api/entries?sort=createdAt&order=asc&limit=1",
    { cookie: cookieA }
  );
  assert.equal((await createdSort.json()).data[0]._id, entryA._id);

  for (const invalidQuery of [
    "page=0",
    "limit=51",
    "mood=UNKNOWN",
    "favorite=yes",
    "from=2025-02-30",
    "from=2026-10-08&to=2026-10-07",
    `search=${"x".repeat(101)}`,
    "page=10002&limit=10",
    "search=!!!",
    "unknown=value",
  ]) {
    const invalidResponse = await request(`/api/entries?${invalidQuery}`, {
      cookie: cookieA,
    });
    assert.equal(invalidResponse.status, 400, invalidQuery);
  }

  const calendarDates = await request(
    `/api/entries/calendar/dates?from=${today}&to=${today}`,
    { cookie: cookieA }
  );
  assert.deepEqual((await calendarDates.json()).dates, [today]);

  const streak = await request(`/api/entries/streak?today=${today}`, {
    cookie: cookieA,
  });
  assert.equal(streak.status, 200);
  assert.deepEqual(await streak.json(), {
    current: 1,
    longest: 1,
    writtenToday: true,
  });
  for (const invalidStreakQuery of [
    `/api/entries/streak?today=${today}&extra=value`,
    `/api/entries/streak?today=${today}&today=${today}`,
  ]) {
    const invalidStreak = await request(invalidStreakQuery, {
      cookie: cookieA,
    });
    assert.equal(invalidStreak.status, 400);
  }

  await DiaryEntry.collection.insertOne({
    userId: userA._id,
    date: "2025-12-31",
    title: "Legacy year end entry",
  });
  await DiaryEntry.create([
    { userId: userA._id, date: "2026-01-01", title: "New year morning" },
    { userId: userA._id, date: "2026-01-01", title: "New year evening" },
    { userId: userA._id, date: "2026-01-02", title: "Second day" },
    { userId: userA._id, date: "2024-02-28", title: "Leap week" },
    { userId: userA._id, date: "2024-02-29", title: "Leap day" },
    { userId: userA._id, date: "2024-03-01", title: "March begins" },
    {
      userId: userA._id,
      date: "2026-01-03",
      title: "Unpublished",
      isDraft: true,
    },
  ]);

  const yearBoundaryActivity = await request(
    "/api/entries/calendar/activity?from=2025-12-31&to=2026-01-02",
    { cookie: cookieA }
  );
  assert.equal(yearBoundaryActivity.status, 200);
  assert.deepEqual((await yearBoundaryActivity.json()).data, [
    { date: "2025-12-31", count: 1 },
    { date: "2026-01-01", count: 2 },
    { date: "2026-01-02", count: 1 },
  ]);
  const leapYearActivity = await request(
    "/api/entries/calendar/activity?from=2024-02-28&to=2024-03-01",
    { cookie: cookieA }
  );
  assert.deepEqual((await leapYearActivity.json()).data, [
    { date: "2024-02-28", count: 1 },
    { date: "2024-02-29", count: 1 },
    { date: "2024-03-01", count: 1 },
  ]);
  const draftActivity = await request(
    "/api/entries/calendar/day?date=2026-01-03",
    { cookie: cookieA }
  );
  assert.equal((await draftActivity.json()).pagination.total, 0);

  const secondSameDayEntry = await request(
    "/api/entries/calendar/day?date=2026-01-01&page=2&limit=1",
    { cookie: cookieA }
  );
  const secondSameDayEntryData = await secondSameDayEntry.json();
  assert.equal(secondSameDayEntry.status, 200);
  assert.equal(secondSameDayEntryData.data.length, 1);
  assert.equal(secondSameDayEntryData.pagination.total, 2);
  assert.equal(secondSameDayEntryData.pagination.page, 2);

  const yearBoundaryStreak = await request(
    "/api/entries/streak?today=2026-01-02",
    { cookie: cookieA }
  );
  assert.deepEqual(await yearBoundaryStreak.json(), {
    current: 3,
    longest: 3,
    writtenToday: true,
  });
  const leapYearStreak = await request("/api/entries/streak?today=2024-03-01", {
    cookie: cookieA,
  });
  assert.deepEqual(await leapYearStreak.json(), {
    current: 3,
    longest: 3,
    writtenToday: true,
  });

  const dailyDashboard = await request(
    `/api/dashboard?today=${today}&group=day`,
    { cookie: cookieA }
  );
  const dailyDashboardData = await dailyDashboard.json();
  assert.equal(dailyDashboard.status, 200);
  assert.equal(
    dailyDashboardData.summary.totalEntries,
    await DiaryEntry.countDocuments({
      userId: userA._id,
      isDraft: { $ne: true },
    })
  );
  assert.equal(dailyDashboardData.summary.favoriteCount, 1);
  assert.ok(dailyDashboardData.summary.entriesThisWeek >= 1);
  assert.ok(dailyDashboardData.summary.entriesThisMonth >= 1);
  assert.equal(dailyDashboardData.summary.writtenToday, true);
  assert.equal(
    dailyDashboardData.moodDistribution.reduce(
      (total, item) => total + item.count,
      0
    ),
    dailyDashboardData.summary.totalEntries
  );
  assert.ok(dailyDashboardData.topTags.some(({ tag }) => tag === "family"));
  assert.ok(
    dailyDashboardData.recentEntries.every(
      (entry) => entry.content === undefined && entry.userId === undefined
    )
  );
  assert.equal(dailyDashboardData.favoriteEntries.length, 1);
  assert.deepEqual(dailyDashboardData.period, {
    group: "day",
    from: new Date(new Date(`${today}T00:00:00.000Z`).getTime() - 29 * 86400000)
      .toISOString()
      .slice(0, 10),
    to: today,
  });

  const weeklyDashboard = await request(
    `/api/dashboard?today=${today}&group=week`,
    { cookie: cookieA }
  );
  const weeklyDashboardData = await weeklyDashboard.json();
  assert.equal(weeklyDashboard.status, 200);
  assert.equal(weeklyDashboardData.period.group, "week");
  assert.ok(
    weeklyDashboardData.activity.every(({ period }) =>
      /^\d{4}-\d{2}-\d{2}$/.test(period)
    )
  );

  const monthlyDashboard = await request(
    `/api/dashboard?today=${today}&group=month`,
    { cookie: cookieA }
  );
  const monthlyDashboardData = await monthlyDashboard.json();
  assert.equal(monthlyDashboard.status, 200);
  assert.equal(monthlyDashboardData.period.group, "month");
  assert.ok(
    monthlyDashboardData.activity.every(({ period }) =>
      /^\d{4}-\d{2}$/.test(period)
    )
  );

  for (const invalidDashboardQuery of [
    `/api/dashboard?today=${today}&group=year`,
    "/api/dashboard?today=2026-02-30",
    `/api/dashboard?today=${today}&extra=value`,
    `/api/dashboard?today=${today}&today=${today}`,
  ]) {
    const invalidDashboard = await request(invalidDashboardQuery, {
      cookie: cookieA,
    });
    assert.equal(invalidDashboard.status, 400);
  }

  const oversizedCalendarRange = await request(
    "/api/entries/calendar/activity?from=2024-01-01&to=2025-01-01",
    { cookie: cookieA }
  );
  assert.equal(oversizedCalendarRange.status, 400);
  const invalidCalendarDay = await request(
    "/api/entries/calendar/day?date=2026-02-30",
    { cookie: cookieA }
  );
  assert.equal(invalidCalendarDay.status, 400);
  const duplicateCalendarDate = await request(
    "/api/entries/calendar/day?date=2026-01-01&date=2026-01-02",
    { cookie: cookieA }
  );
  assert.equal(duplicateCalendarDate.status, 400);

  const taskListA = await request("/api/tasks", { cookie: cookieA });
  const taskListAData = await taskListA.json();
  assert.equal(taskListA.status, 200);
  assert.deepEqual(
    taskListAData.map(({ _id }) => _id),
    [taskA._id]
  );
  assert.equal(taskListAData[0].priority, "MEDIUM");
  assert.equal(taskListAData[0].status, "TODO");
  const completedTaskResponse = await request(`/api/tasks/${taskA._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { completed: true },
  });
  assert.equal(completedTaskResponse.status, 200);
  assert.equal((await completedTaskResponse.json()).completed, true);

  const invalidTaskResponses = await Promise.all([
    request("/api/tasks", {
      method: "POST",
      cookie: cookieA,
      body: { text: "  ", date: today },
    }),
    request("/api/tasks", {
      method: "POST",
      cookie: cookieA,
      body: { text: "Bad due date", dueDate: "2026-02-30" },
    }),
    request("/api/tasks", {
      method: "POST",
      cookie: cookieA,
      body: { text: "Bad priority", dueDate: today, priority: "URGENT" },
    }),
    request("/api/tasks", {
      method: "POST",
      cookie: cookieA,
      body: {
        text: "Removed reminder field",
        dueDate: today,
        reminderTime: "09:30",
      },
    }),
    request("/api/tasks", {
      method: "POST",
      cookie: cookieA,
      body: { text: "Unknown field", dueDate: today, ownerId: userA._id },
    }),
  ]);
  assert.ok(invalidTaskResponses.every(({ status }) => status === 400));

  const recurringTaskResponse = await request("/api/tasks", {
    method: "POST",
    cookie: cookieA,
    body: {
      text: "Review monthly budget",
      dueDate: "2026-01-31",
      priority: "HIGH",
      recurrence: "MONTHLY",
    },
  });
  assert.equal(recurringTaskResponse.status, 201);
  const recurringTask = await recurringTaskResponse.json();
  const recurringCompletion = await request(`/api/tasks/${recurringTask._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "COMPLETED" },
  });
  const recurringCompletionData = await recurringCompletion.json();
  assert.equal(recurringCompletion.status, 200);
  assert.equal(recurringCompletionData.status, "COMPLETED");
  assert.equal(recurringCompletionData.nextTask.dueDate, "2026-02-28");
  assert.equal(recurringCompletionData.nextTask.priority, "HIGH");

  const repeatedCompletions = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(`/api/tasks/${recurringTask._id}`, {
        method: "PATCH",
        cookie: cookieA,
        body: { completed: true },
      })
    )
  );
  const repeatedCompletionData = await Promise.all(
    repeatedCompletions.map((response) => response.json())
  );
  assert.ok(
    repeatedCompletionData.every(
      ({ nextTask }) => nextTask._id === recurringCompletionData.nextTask._id
    )
  );
  const recurringOccurrences = await DailyTask.countDocuments({
    userId: userA._id,
    recurrenceSeriesId: recurringTask.recurrenceSeriesId,
  });
  assert.equal(recurringOccurrences, 2);

  const weeklyTaskResponse = await request("/api/tasks", {
    method: "POST",
    cookie: cookieA,
    body: {
      text: "Weekly review",
      dueDate: "2026-12-29",
      recurrence: "WEEKLY",
    },
  });
  const weeklyTask = await weeklyTaskResponse.json();
  const weeklyCompletion = await request(`/api/tasks/${weeklyTask._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "COMPLETED" },
  });
  assert.equal((await weeklyCompletion.json()).nextTask.dueDate, "2027-01-05");

  const dailyTaskResponse = await request("/api/tasks", {
    method: "POST",
    cookie: cookieA,
    body: { text: "Daily review", dueDate: "2026-12-31", recurrence: "DAILY" },
  });
  const dailyTask = await dailyTaskResponse.json();
  const cancelledDailyTask = await request(`/api/tasks/${dailyTask._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "CANCELLED" },
  });
  assert.equal(cancelledDailyTask.status, 200);
  assert.equal(
    await DailyTask.countDocuments({
      userId: userA._id,
      recurrenceSeriesId: dailyTask.recurrenceSeriesId,
    }),
    1
  );
  const dailyCompletion = await request(`/api/tasks/${dailyTask._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "COMPLETED" },
  });
  assert.equal((await dailyCompletion.json()).nextTask.dueDate, "2027-01-01");

  const editedTaskResponse = await request(`/api/tasks/${taskA._id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { text: "Updated task", priority: "LOW", status: "IN_PROGRESS" },
  });
  const editedTask = await editedTaskResponse.json();
  assert.equal(editedTaskResponse.status, 200);
  assert.equal(editedTask.text, "Updated task");
  assert.equal(editedTask.priority, "LOW");
  assert.equal(editedTask.status, "IN_PROGRESS");

  const invalidTaskFilters = await Promise.all([
    request("/api/tasks?status=UNKNOWN", { cookie: cookieA }),
    request("/api/tasks?from=2026-02-30", { cookie: cookieA }),
    request("/api/tasks?limit=101", { cookie: cookieA }),
    request("/api/tasks?unexpected=true", { cookie: cookieA }),
  ]);
  assert.ok(invalidTaskFilters.every(({ status }) => status === 400));

  const highPriorityTasks = await request(
    "/api/tasks?priority=HIGH&from=2026-01-01&to=2026-02-28",
    { cookie: cookieA }
  );
  assert.equal((await highPriorityTasks.json()).pagination.total, 2);

  await DailyTask.collection.insertOne({
    userId: userA._id,
    text: "Legacy completed task",
    date: today,
    completed: true,
  });
  const legacyTasks = await request(
    "/api/tasks?status=COMPLETED&date=" + today,
    { cookie: cookieA }
  );
  assert.ok(
    (await legacyTasks.json()).data.some(
      ({ text, status }) =>
        text === "Legacy completed task" && status === "COMPLETED"
    )
  );

  const registeredB = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailB, password, displayName: "User B" },
  });
  assert.equal(registeredB.status, 201);
  const cookieB = readSessionCookie(registeredB);
  const userB = await User.findOne({ email: emailB });
  const entryBResponse = await request("/api/entries", {
    method: "POST",
    cookie: cookieB,
    body: { title: "B private entry", content: "Only user B", date: today },
  });
  assert.equal(entryBResponse.status, 201);
  const entryB = await entryBResponse.json();
  assert.equal(String(entryB.userId), String(userB._id));

  assert.equal(
    (
      await request(`/api/entries/${entryA._id}/images/${attachment.id}`, {
        cookie: cookieB,
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryA._id}/images/${attachment.id}`, {
        method: "DELETE",
        cookie: cookieB,
      })
    ).status,
    404
  );
  assert.equal(
    (
      await uploadRequest(`/api/entries/${entryB._id}/images`, {
        cookie: cookieA,
        buffer: imageBuffer,
        filename: "private.png",
        mimeType: "image/png",
      })
    ).status,
    404
  );
  const deletedImage = await request(
    `/api/entries/${entryA._id}/images/${attachment.id}`,
    { method: "DELETE", cookie: cookieA }
  );
  assert.equal(deletedImage.status, 200);
  await assert.rejects(access(imageFilePath(attachment.id)));
  imageIds.shift();
  assert.equal(
    (
      await request(`/api/entries/${entryA._id}/images/${attachment.id}`, {
        cookie: cookieA,
      })
    ).status,
    404
  );

  const taskBResponse = await request("/api/tasks", {
    method: "POST",
    cookie: cookieB,
    body: { text: "B private task", date: today },
  });
  assert.equal(taskBResponse.status, 201);
  const taskB = await taskBResponse.json();
  assert.equal(String(taskB.userId), String(userB._id));

  const listB = await request("/api/entries", { cookie: cookieB });
  assert.deepEqual(
    (await listB.json()).data.map((entry) => entry._id),
    [entryB._id]
  );
  const calendarActivityB = await request(
    "/api/entries/calendar/activity?from=2025-12-31&to=2026-01-02",
    { cookie: cookieB }
  );
  assert.deepEqual((await calendarActivityB.json()).data, []);
  const calendarDayB = await request(
    "/api/entries/calendar/day?date=2026-01-01",
    { cookie: cookieB }
  );
  assert.deepEqual((await calendarDayB.json()).pagination.total, 0);
  const dashboardB = await request(`/api/dashboard?today=${today}&group=day`, {
    cookie: cookieB,
  });
  const dashboardBData = await dashboardB.json();
  assert.equal(dashboardBData.summary.totalEntries, 1);
  assert.deepEqual(dashboardBData.topTags, []);
  assert.equal(dashboardBData.favoriteEntries.length, 0);
  assert.equal(
    (await request(`/api/entries/${entryB._id}`, { cookie: cookieA })).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryB._id}`, {
        method: "PUT",
        cookie: cookieA,
        body: { title: "stolen", content: "stolen" },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryB._id}`, {
        method: "DELETE",
        cookie: cookieA,
      })
    ).status,
    404
  );
  assert.equal(
    (await request(`/api/entries/${entryA._id}`, { cookie: cookieB })).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryA._id}`, {
        method: "PUT",
        cookie: cookieB,
        body: { title: "stolen", content: "stolen" },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryA._id}`, {
        method: "DELETE",
        cookie: cookieB,
      })
    ).status,
    404
  );

  const dashboardBeforeTrash = await request(
    `/api/dashboard?today=${today}&group=day`,
    { cookie: cookieA }
  );
  const dashboardBeforeTrashData = await dashboardBeforeTrash.json();
  const calendarBeforeTrash = await request(
    `/api/entries/calendar/activity?from=${today}&to=${today}`,
    { cookie: cookieA }
  );
  const calendarBeforeTrashData = await calendarBeforeTrash.json();
  const calendarDayBeforeTrash = await request(
    `/api/entries/calendar/day?date=${today}`,
    { cookie: cookieA }
  );
  const calendarDayBeforeTrashData = await calendarDayBeforeTrash.json();
  assert.equal(dashboardBeforeTrash.status, 200);
  assert.equal(calendarBeforeTrash.status, 200);
  assert.equal(calendarDayBeforeTrash.status, 200);

  const ownEntryDelete = await request(`/api/entries/${entryA._id}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  assert.equal(ownEntryDelete.status, 200);
  assert.ok((await DiaryEntry.findById(entryA._id)).deletedAt);
  for (const imageId of imageIds) {
    await access(imageFilePath(imageId));
  }
  const imageInTrash = await request(
    `/api/entries/${entryA._id}/images/${imageIds[0]}`,
    { cookie: cookieA }
  );
  assert.equal(imageInTrash.status, 200);
  await imageInTrash.arrayBuffer();
  assert.equal(
    (await request(`/api/entries/${entryA._id}`, { cookie: cookieA })).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/${entryA._id}`, {
        method: "PUT",
        cookie: cookieA,
        body: { title: "Cannot update trash", content: "Not active" },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await uploadRequest(`/api/entries/${entryA._id}/images`, {
        cookie: cookieA,
        buffer: imageBuffer,
        filename: "trashed.png",
        mimeType: "image/png",
      })
    ).status,
    404
  );

  const activeSearchAfterTrash = await request("/api/entries?search=rich", {
    cookie: cookieA,
  });
  const activeSearchAfterTrashData = await activeSearchAfterTrash.json();
  assert.equal(activeSearchAfterTrash.status, 200);
  assert.equal(
    activeSearchAfterTrashData.pagination.total,
    0,
    JSON.stringify(activeSearchAfterTrashData.data)
  );
  const trashList = await request(
    "/api/entries/trash?search=rich&page=1&limit=1",
    { cookie: cookieA }
  );
  const trashListData = await trashList.json();
  assert.equal(trashList.status, 200);
  assert.deepEqual(trashListData.pagination, {
    page: 1,
    limit: 1,
    total: 1,
    totalPages: 1,
  });
  assert.equal(trashListData.data[0]._id, entryA._id);
  assert.ok(trashListData.data[0].deletedAt);
  const trashListB = await request("/api/entries/trash", { cookie: cookieB });
  assert.equal((await trashListB.json()).pagination.total, 0);
  assert.equal(
    (
      await request(`/api/entries/trash/${entryA._id}/restore`, {
        method: "POST",
        cookie: cookieB,
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/entries/trash/${entryA._id}`, {
        method: "DELETE",
        cookie: cookieB,
      })
    ).status,
    404
  );

  const restored = await request(`/api/entries/trash/${entryA._id}/restore`, {
    method: "POST",
    cookie: cookieA,
  });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).entry.deletedAt, null);
  assert.equal(
    (await request(`/api/entries/${entryA._id}`, { cookie: cookieA })).status,
    200
  );
  assert.equal(
    (
      await request(`/api/entries/trash/${entryA._id}/restore`, {
        method: "POST",
        cookie: cookieA,
      })
    ).status,
    404
  );
  const dashboardAfterRestore = await request(
    `/api/dashboard?today=${today}&group=day`,
    { cookie: cookieA }
  );
  assert.equal(
    (await dashboardAfterRestore.json()).summary.totalEntries,
    dashboardBeforeTrashData.summary.totalEntries
  );

  assert.equal(
    (
      await request(`/api/entries/${entryA._id}`, {
        method: "DELETE",
        cookie: cookieA,
      })
    ).status,
    200
  );
  const dashboardAfterTrash = await request(
    `/api/dashboard?today=${today}&group=day`,
    { cookie: cookieA }
  );
  const dashboardAfterTrashData = await dashboardAfterTrash.json();
  assert.equal(dashboardAfterTrash.status, 200);
  assert.equal(
    dashboardAfterTrashData.summary.totalEntries,
    dashboardBeforeTrashData.summary.totalEntries - 1
  );
  const calendarAfterTrash = await request(
    `/api/entries/calendar/activity?from=${today}&to=${today}`,
    { cookie: cookieA }
  );
  const calendarAfterTrashData = await calendarAfterTrash.json();
  const activityCount = (data) =>
    data.data.find(({ date }) => date === today)?.count ?? 0;
  assert.equal(
    activityCount(calendarAfterTrashData),
    activityCount(calendarBeforeTrashData) - 1
  );
  const calendarDayAfterTrash = await request(
    `/api/entries/calendar/day?date=${today}`,
    { cookie: cookieA }
  );
  assert.equal(
    (await calendarDayAfterTrash.json()).pagination.total,
    calendarDayBeforeTrashData.pagination.total - 1
  );

  const permanentDelete = await request(`/api/entries/trash/${entryA._id}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  assert.equal(permanentDelete.status, 200);
  assert.equal(await DiaryEntry.exists({ _id: entryA._id }), null);
  for (const imageId of imageIds) {
    await assert.rejects(access(imageFilePath(imageId)));
  }
  assert.equal(
    (
      await request(`/api/entries/trash/${entryA._id}`, {
        method: "DELETE",
        cookie: cookieA,
      })
    ).status,
    404
  );

  const ownTaskDelete = await request(`/api/tasks/${taskA._id}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  assert.equal(ownTaskDelete.status, 200);

  const listTasksB = await request("/api/tasks", { cookie: cookieB });
  assert.deepEqual(
    (await listTasksB.json()).map((task) => task._id),
    [taskB._id]
  );
  assert.equal(
    (
      await request(`/api/tasks/${taskB._id}`, {
        method: "PATCH",
        cookie: cookieA,
        body: { text: "Not yours" },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/tasks/${taskB._id}`, {
        method: "PATCH",
        cookie: cookieA,
        body: { completed: true },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/tasks/${taskB._id}`, {
        method: "DELETE",
        cookie: cookieA,
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/tasks/${taskA._id}`, {
        method: "PATCH",
        cookie: cookieB,
        body: { completed: true },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await request(`/api/tasks/${taskA._id}`, {
        method: "DELETE",
        cookie: cookieB,
      })
    ).status,
    404
  );

  const expiredToken = jwt.sign(
    { ver: userA.tokenVersion },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      audience: tokenAudience,
      expiresIn: -1,
      issuer: tokenIssuer,
      subject: userA.id,
    }
  );
  const expiredRequest = await request("/api/entries", {
    cookie: `mydiary_session=${expiredToken}`,
  });
  assert.equal(expiredRequest.status, 401);
  assert.ok(expiredRequest.headers.getSetCookie().length > 0);
  assert.equal(
    (
      await request("/api/entries", {
        cookie: "mydiary_session=not.a.valid.jwt",
      })
    ).status,
    401
  );

  const loggedOut = await request("/api/auth/logout", {
    method: "POST",
    cookie: cookieLoginA,
  });
  assert.equal(loggedOut.status, 200);
  assert.equal(
    (await request("/api/auth/me", { cookie: cookieLoginA })).status,
    401
  );
  assert.equal(
    (await request("/api/entries", { cookie: cookieA })).status,
    401
  );

  const throttledIp = "203.0.113.42";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(
      (
        await request("/api/auth/login", {
          method: "POST",
          requestIp: throttledIp,
          body: {
            email: `missing-${emailSuffix}@example.test`,
            password,
          },
        })
      ).status,
      401
    );
  }
  const rateLimited = await request("/api/auth/login", {
    method: "POST",
    requestIp: throttledIp,
    body: {
      email: `missing-${emailSuffix}@example.test`,
      password,
    },
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(
    (await rateLimited.json()).message,
    "Too many authentication attempts. Please try again later."
  );
});

test("backup exports are private and restore validated records into the active user", async () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await request("/api/backup/export?format=json")).status, 401);
  assert.equal(
    (
      await backupUploadRequest("/api/backup/import/preview", {
        buffer: Buffer.from("not authenticated"),
      })
    ).status,
    401
  );

  const sourceRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailC, password, displayName: "Backup Source" },
  });
  const sourceCookie = readSessionCookie(sourceRegistration);
  const sourceUser = await User.findOne({ email: emailC });
  const targetRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailD, password, displayName: "Backup Target" },
  });
  const targetCookie = readSessionCookie(targetRegistration);
  const emptyExport = await request("/api/backup/export?format=json", {
    cookie: targetCookie,
  });
  assert.equal(emptyExport.status, 200);
  const emptyArchive = await unzipper.Open.buffer(
    Buffer.from(await emptyExport.arrayBuffer())
  );
  const emptyManifest = JSON.parse(
    (
      await emptyArchive.files
        .find((file) => file.path === "manifest.json")
        .buffer()
    ).toString("utf8")
  );
  assert.deepEqual(emptyManifest.counts, {
    entries: 0,
    tasks: 0,
    attachments: 0,
  });

  const entryResponse = await request("/api/entries", {
    method: "POST",
    cookie: sourceCookie,
    body: {
      title: "Backup entry",
      content: "<p>Private backup content</p>",
      date: today,
      mood: "HAPPY",
      tags: ["Study"],
      isFavorite: true,
    },
  });
  assert.equal(entryResponse.status, 201);
  const sourceEntry = await entryResponse.json();
  const image = await sharp({
    create: {
      width: 3,
      height: 3,
      channels: 3,
      background: "#336699",
    },
  })
    .png()
    .toBuffer();
  const attached = await uploadRequest(
    `/api/entries/${sourceEntry._id}/images`,
    {
      cookie: sourceCookie,
      buffer: image,
      filename: "portrait.png",
      mimeType: "image/png",
    }
  );
  assert.equal(attached.status, 201);

  const trashedResponse = await request("/api/entries", {
    method: "POST",
    cookie: sourceCookie,
    body: {
      title: "Trashed backup entry",
      content: "In trash",
      date: today,
    },
  });
  assert.equal(trashedResponse.status, 201);
  const trashedEntry = await trashedResponse.json();
  assert.equal(
    (
      await request(`/api/entries/${trashedEntry._id}`, {
        method: "DELETE",
        cookie: sourceCookie,
      })
    ).status,
    200
  );

  const taskResponse = await request("/api/tasks", {
    method: "POST",
    cookie: sourceCookie,
    body: {
      text: '=HYPERLINK("https://invalid.example","open")',
      date: "2026-10-10",
      priority: "HIGH",
    },
  });
  assert.equal(taskResponse.status, 201);

  const jsonExport = await request(
    "/api/backup/export?format=json&includeTrash=true",
    { cookie: sourceCookie }
  );
  assert.equal(jsonExport.status, 200);
  assert.match(jsonExport.headers.get("content-type"), /application\/zip/);
  assert.match(
    jsonExport.headers.get("content-disposition"),
    /^attachment; filename="mydiary-json-\d{4}-\d{2}-\d{2}\.zip"$/
  );
  const archiveBuffer = Buffer.from(await jsonExport.arrayBuffer());
  const jsonArchive = await unzipper.Open.buffer(archiveBuffer);
  const archiveFiles = new Map(
    jsonArchive.files.map((file) => [file.path, file])
  );
  assert.ok(archiveFiles.has("manifest.json"));
  assert.ok(archiveFiles.has("data.json"));
  const manifest = JSON.parse(
    (await archiveFiles.get("manifest.json").buffer()).toString("utf8")
  );
  const backupData = JSON.parse(
    (await archiveFiles.get("data.json").buffer()).toString("utf8")
  );
  assert.deepEqual(manifest.counts, {
    entries: 2,
    tasks: 1,
    attachments: 1,
  });
  assert.equal(
    backupData.entries.find((entry) => entry.title === "Backup entry")
      .isFavorite,
    true
  );
  assert.ok(
    backupData.entries.find((entry) => entry.title === "Trashed backup entry")
      .deletedAt
  );
  assert.equal(backupData.profile.email, emailC);
  assert.equal("passwordHash" in backupData.profile, false);
  assert.equal("tokenVersion" in backupData.profile, false);
  const imageRecord = backupData.entries.find(
    (entry) => entry.title === "Backup entry"
  ).images[0];
  assert.ok(archiveFiles.has(imageRecord.path));

  const noTrashExport = await request(
    "/api/backup/export?format=json&includeTrash=false",
    { cookie: sourceCookie }
  );
  const noTrashArchive = await unzipper.Open.buffer(
    Buffer.from(await noTrashExport.arrayBuffer())
  );
  const noTrashData = JSON.parse(
    (
      await noTrashArchive.files
        .find((file) => file.path === "data.json")
        .buffer()
    ).toString("utf8")
  );
  assert.equal(noTrashData.entries.length, 1);
  assert.equal(noTrashData.entries[0].title, "Backup entry");

  const preview = await backupUploadRequest("/api/backup/import/preview", {
    cookie: targetCookie,
    buffer: archiveBuffer,
  });
  assert.equal(preview.status, 200);
  const previewData = await preview.json();
  assert.equal(previewData.alreadyImported, false);
  assert.deepEqual(
    {
      entries: previewData.statistics.entries,
      trashedEntries: previewData.statistics.trashedEntries,
      tasks: previewData.statistics.tasks,
      attachments: previewData.statistics.attachments,
    },
    { entries: 2, trashedEntries: 1, tasks: 1, attachments: 1 }
  );
  const targetEntriesBeforeImport = await request("/api/entries", {
    cookie: targetCookie,
  });
  assert.equal((await targetEntriesBeforeImport.json()).pagination.total, 0);

  const restored = await backupUploadRequest("/api/backup/import", {
    cookie: targetCookie,
    buffer: archiveBuffer,
    confirmed: true,
  });
  assert.equal(restored.status, 201);
  const restoredData = await restored.json();
  assert.deepEqual(restoredData.statistics, previewData.statistics);
  const targetEntriesResponse = await request("/api/entries?limit=50", {
    cookie: targetCookie,
  });
  const targetEntries = (await targetEntriesResponse.json()).data;
  assert.equal(targetEntries.length, 1);
  assert.equal(targetEntries[0].title, "Backup entry");
  const targetUser = await User.findOne({ email: emailD });
  const importedEntry = await DiaryEntry.findOne({
    userId: targetUser._id,
    title: "Backup entry",
  });
  assert.equal(String(importedEntry.userId), String(targetUser._id));
  assert.equal(importedEntry.images.length, 1);
  await access(imageFilePath(importedEntry.images[0].id));
  const targetTrash = await request("/api/entries/trash", {
    cookie: targetCookie,
  });
  assert.equal((await targetTrash.json()).pagination.total, 1);
  const targetTasks = await request("/api/tasks", { cookie: targetCookie });
  assert.equal((await targetTasks.json()).length, 1);

  const duplicate = await backupUploadRequest("/api/backup/import", {
    cookie: targetCookie,
    buffer: archiveBuffer,
    confirmed: true,
  });
  assert.equal(duplicate.status, 409);
  const missingConfirmation = await backupUploadRequest("/api/backup/import", {
    cookie: targetCookie,
    buffer: archiveBuffer,
  });
  assert.equal(missingConfirmation.status, 400);

  const invalid = await backupUploadRequest("/api/backup/import/preview", {
    cookie: targetCookie,
    buffer: Buffer.from("not a ZIP"),
  });
  assert.equal(invalid.status, 400);

  const csvExport = await request(
    "/api/backup/export?format=csv&includeTrash=false",
    { cookie: sourceCookie }
  );
  assert.equal(csvExport.status, 200);
  assert.match(csvExport.headers.get("content-type"), /application\/zip/);
  const csvArchive = await unzipper.Open.buffer(
    Buffer.from(await csvExport.arrayBuffer())
  );
  const csvFiles = new Set(csvArchive.files.map((file) => file.path));
  assert.ok(csvFiles.has("entries.csv"));
  assert.ok(csvFiles.has("tasks.csv"));
  assert.ok(csvFiles.has("attachments.csv"));
  const csvTasks = await csvArchive.files
    .find((file) => file.path === "tasks.csv")
    .buffer();
  assert.match(csvTasks.toString("utf8"), /"'=HYPERLINK/);
  const csvEntries = await csvArchive.files
    .find((file) => file.path === "entries.csv")
    .buffer();
  assert.match(csvEntries.toString("utf8"), /Backup entry/);
  assert.doesNotMatch(csvEntries.toString("utf8"), /Trashed backup entry/);

  const pdfExport = await request("/api/backup/export?format=pdf", {
    cookie: sourceCookie,
  });
  assert.equal(pdfExport.status, 200);
  assert.match(pdfExport.headers.get("content-type"), /application\/pdf/);
  assert.match(
    pdfExport.headers.get("content-disposition"),
    /^attachment; filename="mydiary-pdf-\d{4}-\d{2}-\d{2}\.pdf"$/
  );
  assert.ok((await pdfExport.arrayBuffer()).byteLength > 500);

  await DailyTask.insertMany(
    Array.from({ length: 250 }, (_, index) => ({
      userId: sourceUser._id,
      text: `Large export task ${index}`,
      date: today,
      dueDate: today,
    }))
  );
  const largerExport = await request("/api/backup/export?format=json", {
    cookie: sourceCookie,
  });
  assert.equal(largerExport.status, 200);
  const largerArchive = await unzipper.Open.buffer(
    Buffer.from(await largerExport.arrayBuffer())
  );
  const largerManifest = JSON.parse(
    (
      await largerArchive.files
        .find((file) => file.path === "manifest.json")
        .buffer()
    ).toString("utf8")
  );
  assert.equal(largerManifest.counts.tasks, 251);

  const invalidFormat = await request("/api/backup/export?format=xml", {
    cookie: sourceCookie,
  });
  assert.equal(invalidFormat.status, 400);
});

test("profile settings, password rotation, preferences, and account deletion are owner-scoped", async () => {
  assert.equal((await request("/api/profile")).status, 401);
  const ownerRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailE, password, displayName: "Phase Fourteen" },
  });
  const ownerCookie = readSessionCookie(ownerRegistration);
  const owner = await User.findOne({ email: emailE });
  const otherRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { email: emailF, password, displayName: "Unaffected User" },
  });
  const otherCookie = readSessionCookie(otherRegistration);
  const otherEntryResponse = await request("/api/entries", {
    method: "POST",
    cookie: otherCookie,
    body: {
      title: "Keep this entry",
      content: "Owned by another account",
      date: new Date().toISOString().slice(0, 10),
    },
  });
  const otherEntry = await otherEntryResponse.json();
  const otherUser = await User.findOne({ email: emailF });

  const profileResponse = await request("/api/profile", {
    cookie: ownerCookie,
  });
  assert.equal(profileResponse.status, 200);
  const profile = (await profileResponse.json()).profile;
  assert.equal(profile.email, emailE);
  assert.equal(profile.displayName, "Phase Fourteen");
  assert.ok(profile.createdAt);
  assert.deepEqual(profile.notificationPreferences, {
    browserNotifications: false,
    taskReminders: false,
  });
  assert.equal("passwordHash" in profile, false);
  assert.equal("tokenVersion" in profile, false);

  const profileUpdate = await request("/api/profile", {
    method: "PATCH",
    cookie: ownerCookie,
    body: {
      displayName: "Updated Name",
      notificationPreferences: {
        browserNotifications: true,
        taskReminders: true,
      },
    },
  });
  assert.equal(profileUpdate.status, 200);
  const updatedProfile = (await profileUpdate.json()).profile;
  assert.equal(updatedProfile.displayName, "Updated Name");
  assert.deepEqual(updatedProfile.notificationPreferences, {
    browserNotifications: true,
    taskReminders: true,
  });
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        cookie: ownerCookie,
        body: { email: "changed@example.test" },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        cookie: ownerCookie,
        body: { displayName: "Bad\u0000Name" },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        cookie: ownerCookie,
        body: { notificationPreferences: { taskReminders: "yes" } },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request("/api/profile/password", {
        method: "POST",
        cookie: ownerCookie,
        body: {
          currentPassword: "wrong password",
          newPassword: "new strong password",
        },
      })
    ).status,
    401
  );
  assert.equal(
    (
      await request("/api/profile/password", {
        method: "POST",
        cookie: ownerCookie,
        body: { currentPassword: password, newPassword: "short" },
      })
    ).status,
    400
  );

  const newPassword = "another secure passphrase";
  const passwordChanged = await request("/api/profile/password", {
    method: "POST",
    cookie: ownerCookie,
    body: { currentPassword: password, newPassword },
  });
  assert.equal(passwordChanged.status, 200);
  const rotatedCookie = readSessionCookie(passwordChanged);
  assert.equal(
    (await request("/api/profile", { cookie: ownerCookie })).status,
    401
  );
  assert.equal(
    (await request("/api/profile", { cookie: rotatedCookie })).status,
    200
  );

  const today = new Date().toISOString().slice(0, 10);
  const entryResponse = await request("/api/entries", {
    method: "POST",
    cookie: rotatedCookie,
    body: { title: "Delete with account", content: "Private", date: today },
  });
  const entry = await entryResponse.json();
  const imageBuffer = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: "#336699",
    },
  })
    .png()
    .toBuffer();
  const imageResponse = await uploadRequest(
    `/api/entries/${entry._id}/images`,
    {
      cookie: rotatedCookie,
      buffer: imageBuffer,
      filename: "account-delete.png",
      mimeType: "image/png",
    }
  );
  assert.equal(imageResponse.status, 201);
  const attachedEntry = await DiaryEntry.findById(entry._id);
  const imageId = attachedEntry.images[0].id;
  await DailyTask.create({
    userId: owner._id,
    text: "Remove with account",
    date: today,
    dueDate: today,
  });
  await BackupImport.create({
    userId: owner._id,
    backupId: randomUUID(),
    status: "COMPLETED",
    completedAt: new Date(),
  });
  assert.equal(
    (
      await request(`/api/entries/${entry._id}`, {
        method: "DELETE",
        cookie: rotatedCookie,
      })
    ).status,
    200
  );

  assert.equal(
    (
      await request("/api/profile", {
        method: "DELETE",
        cookie: rotatedCookie,
        body: { currentPassword: newPassword, confirmation: "no" },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request("/api/profile", {
        method: "DELETE",
        cookie: rotatedCookie,
        body: { currentPassword: password, confirmation: "DELETE" },
      })
    ).status,
    401
  );
  await User.updateOne(
    { _id: owner._id },
    { $set: { deletionRequestedAt: new Date() } }
  );
  assert.equal(
    (await request("/api/entries", { cookie: rotatedCookie })).status,
    403
  );
  assert.equal(
    (await request("/api/auth/me", { cookie: rotatedCookie })).status,
    200
  );
  assert.equal(
    (await request("/api/profile", { cookie: rotatedCookie })).status,
    200
  );
  const deleted = await request("/api/profile", {
    method: "DELETE",
    cookie: rotatedCookie,
    body: { currentPassword: newPassword, confirmation: "DELETE" },
  });
  assert.equal(deleted.status, 200);
  assert.ok(deleted.headers.get("set-cookie"));
  assert.equal(await User.findById(owner._id), null);
  assert.equal(await DiaryEntry.exists({ userId: owner._id }), null);
  assert.equal(await DailyTask.exists({ userId: owner._id }), null);
  assert.equal(await BackupImport.exists({ userId: owner._id }), null);
  await assert.rejects(access(imageFilePath(imageId)));
  assert.ok(
    await DiaryEntry.exists({ _id: otherEntry._id, userId: otherUser._id })
  );
  assert.equal(
    (await request("/api/profile", { cookie: rotatedCookie })).status,
    401
  );
});

test("locked entries require short-lived owner-scoped unlock and stay private across features", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const registerOwner = await request("/api/auth/register", {
    method: "POST",
    requestIp: "203.0.113.71",
    body: { email: emailG, password, displayName: "Locked Entry Owner" },
  });
  assert.equal(registerOwner.status, 201);
  const ownerCookie = readSessionCookie(registerOwner);
  const otherRegistration = await request("/api/auth/register", {
    method: "POST",
    requestIp: "203.0.113.72",
    body: { email: emailH, password, displayName: "Other User" },
  });
  assert.equal(otherRegistration.status, 201);
  const otherCookie = readSessionCookie(otherRegistration);

  const baselineDashboard = await request(
    `/api/dashboard?today=${today}&group=day`,
    { cookie: ownerCookie }
  );
  const baselineSummary = (await baselineDashboard.json()).summary;
  const baselineCalendar = await request(
    `/api/entries/calendar/day?date=${today}`,
    { cookie: ownerCookie }
  );
  const baselineCalendarTotal = (await baselineCalendar.json()).pagination
    .total;

  const created = await request("/api/entries", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      title: "Confidential lock marker",
      content: "<p>Confidential body marker</p>",
      date: today,
      mood: "HAPPY",
      tags: ["private-marker"],
      isFavorite: true,
    },
  });
  assert.equal(created.status, 201);
  const entry = await created.json();
  const lockResponse = await request(`/api/entries/${entry._id}/lock`, {
    method: "POST",
    cookie: ownerCookie,
  });
  assert.equal(lockResponse.status, 200);
  const lockSummary = await lockResponse.json();
  assert.equal(lockSummary.isLocked, true);
  for (const field of [
    "title",
    "content",
    "mood",
    "tags",
    "isFavorite",
    "images",
  ]) {
    assert.equal(Object.hasOwn(lockSummary, field), false);
  }

  const protectedRead = await request(`/api/entries/${entry._id}`, {
    cookie: ownerCookie,
  });
  assert.equal(protectedRead.status, 423);
  assert.match(protectedRead.headers.get("cache-control"), /no-store/);
  const protectedReadData = await protectedRead.json();
  assert.equal(Object.hasOwn(protectedReadData, "content"), false);
  const list = await request("/api/entries", { cookie: ownerCookie });
  const listedEntry = (await list.json()).data.find(
    (item) => item._id === entry._id
  );
  assert.equal(listedEntry.isLocked, true);
  assert.equal(Object.hasOwn(listedEntry, "title"), false);
  assert.equal(Object.hasOwn(listedEntry, "content"), false);
  for (const search of ["Confidential", "body marker", "private-marker"]) {
    const result = await request(
      `/api/entries?search=${encodeURIComponent(search)}`,
      { cookie: ownerCookie }
    );
    assert.equal((await result.json()).pagination.total, 0);
  }
  const filteredFavorite = await request("/api/entries?favorite=true", {
    cookie: ownerCookie,
  });
  assert.equal((await filteredFavorite.json()).pagination.total, 0);

  const dashboard = await request(`/api/dashboard?today=${today}&group=day`, {
    cookie: ownerCookie,
  });
  assert.deepEqual((await dashboard.json()).summary, baselineSummary);
  const calendar = await request(`/api/entries/calendar/day?date=${today}`, {
    cookie: ownerCookie,
  });
  assert.equal((await calendar.json()).pagination.total, baselineCalendarTotal);

  const unauthorizedRead = await request(`/api/entries/${entry._id}`, {
    cookie: otherCookie,
  });
  assert.equal(unauthorizedRead.status, 404);
  const unauthorizedUnlock = await request(`/api/entries/${entry._id}/unlock`, {
    method: "POST",
    requestIp: "203.0.113.73",
    cookie: otherCookie,
    body: { currentPassword: password },
  });
  assert.equal(unauthorizedUnlock.status, 404);

  const wrongPassword = await request(`/api/entries/${entry._id}/unlock`, {
    method: "POST",
    requestIp: "203.0.113.71",
    cookie: ownerCookie,
    body: { currentPassword: "incorrect password" },
  });
  assert.equal(wrongPassword.status, 401);
  const wrongPasswordData = await wrongPassword.json();
  assert.equal(Object.hasOwn(wrongPasswordData, "content"), false);

  const unlocked = await request(`/api/entries/${entry._id}/unlock`, {
    method: "POST",
    requestIp: "203.0.113.71",
    cookie: ownerCookie,
    body: { currentPassword: password },
  });
  assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get("cache-control"), /no-store/);
  assert.equal((await unlocked.json()).title, "Confidential lock marker");
  const unlockSetCookie = (
    unlocked.headers.getSetCookie?.() || [unlocked.headers.get("set-cookie")]
  ).find((value) => value?.startsWith("mydiary_entry_unlock="));
  assert.ok(unlockSetCookie);
  const unlockCookie = unlockSetCookie.split(";", 1)[0];
  const unlockClaims = jwt.decode(unlockCookie.split("=")[1]);
  assert.ok(unlockClaims.exp - unlockClaims.iat <= 5 * 60);
  const cookieWithGrant = `${ownerCookie}; ${unlockCookie}`;

  const refreshedRead = await request(`/api/entries/${entry._id}`, {
    cookie: cookieWithGrant,
  });
  assert.equal(refreshedRead.status, 200);
  assert.equal(
    (await refreshedRead.json()).content,
    "<p>Confidential body marker</p>"
  );
  const deniedImageRead = await request(
    `/api/entries/${entry._id}/images/missing`,
    { cookie: ownerCookie }
  );
  assert.equal(deniedImageRead.status, 423);

  const trashed = await request(`/api/entries/${entry._id}`, {
    method: "DELETE",
    cookie: cookieWithGrant,
  });
  assert.equal(trashed.status, 200);
  const trashResult = await trashed.json();
  assert.equal(trashResult.entry.isLocked, true);
  assert.equal(Object.hasOwn(trashResult.entry, "content"), false);
  const trashSearch = await request("/api/entries/trash?search=Confidential", {
    cookie: ownerCookie,
  });
  assert.equal((await trashSearch.json()).pagination.total, 0);
  const trashList = await request("/api/entries/trash", {
    cookie: ownerCookie,
  });
  const trashedEntry = (await trashList.json()).data.find(
    (item) => item._id === entry._id
  );
  assert.equal(trashedEntry.isLocked, true);
  assert.equal(Object.hasOwn(trashedEntry, "title"), false);
  const restored = await request(`/api/entries/trash/${entry._id}/restore`, {
    method: "POST",
    cookie: cookieWithGrant,
  });
  assert.equal((await restored.json()).entry.isLocked, true);

  const relocked = await request(`/api/entries/${entry._id}/lock`, {
    method: "POST",
    cookie: cookieWithGrant,
  });
  assert.equal(relocked.status, 200);
  assert.equal(
    (
      await request(`/api/entries/${entry._id}`, {
        cookie: cookieWithGrant,
      })
    ).status,
    423
  );

  const exportDefault = await request("/api/backup/export?format=json", {
    cookie: ownerCookie,
  });
  assert.equal(exportDefault.status, 200);
  const defaultArchive = await unzipper.Open.buffer(
    Buffer.from(await exportDefault.arrayBuffer())
  );
  const defaultData = JSON.parse(
    (
      await defaultArchive.files
        .find((file) => file.path === "data.json")
        .buffer()
    ).toString("utf8")
  );
  assert.equal(
    defaultData.entries.some(
      (item) => item.title === "Confidential lock marker"
    ),
    false
  );
  assert.equal(
    JSON.stringify(defaultData).includes("Confidential body marker"),
    false
  );
  const wrongExportPassword = await request("/api/backup/export", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      format: "json",
      includeTrash: true,
      includeLocked: true,
      currentPassword: "incorrect password",
    },
  });
  assert.equal(wrongExportPassword.status, 401);
  const protectedExport = await request("/api/backup/export", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      format: "json",
      includeTrash: true,
      includeLocked: true,
      currentPassword: password,
    },
  });
  assert.equal(protectedExport.status, 200);
  const protectedArchiveBuffer = Buffer.from(
    await protectedExport.arrayBuffer()
  );
  const protectedArchive = await unzipper.Open.buffer(protectedArchiveBuffer);
  const protectedData = JSON.parse(
    (
      await protectedArchive.files
        .find((file) => file.path === "data.json")
        .buffer()
    ).toString("utf8")
  );
  assert.equal(
    protectedData.entries.some(
      (item) =>
        item.title === "Confidential lock marker" && item.isLocked === true
    ),
    true
  );
  const restoredBackup = await backupUploadRequest("/api/backup/import", {
    cookie: otherCookie,
    buffer: protectedArchiveBuffer,
    confirmed: true,
  });
  assert.equal(restoredBackup.status, 201);
  const restoredEntry = await DiaryEntry.findOne({
    userId: (await User.findOne({ email: emailH }))._id,
    title: "Confidential lock marker",
  });
  assert.ok(restoredEntry);
  assert.equal(restoredEntry.isLocked, true);
  assert.equal(
    (
      await request(`/api/entries/${restoredEntry._id}`, {
        cookie: otherCookie,
      })
    ).status,
    423
  );

  const csvExport = await request("/api/backup/export?format=csv", {
    cookie: ownerCookie,
  });
  const csvArchive = await unzipper.Open.buffer(
    Buffer.from(await csvExport.arrayBuffer())
  );
  const csvData = await csvArchive.files
    .find((file) => file.path === "entries.csv")
    .buffer();
  assert.doesNotMatch(csvData.toString("utf8"), /Confidential lock marker/);
  const pdfExport = await request("/api/backup/export?format=pdf", {
    cookie: ownerCookie,
  });
  const pdfData = Buffer.from(await pdfExport.arrayBuffer()).toString("latin1");
  assert.doesNotMatch(
    pdfData,
    /Confidential lock marker|Confidential body marker/
  );

  const freshUnlock = await request(`/api/entries/${entry._id}/unlock`, {
    method: "POST",
    requestIp: "203.0.113.71",
    cookie: ownerCookie,
    body: { currentPassword: password },
  });
  assert.equal(freshUnlock.status, 200);
  const freshUnlockSetCookie = (
    freshUnlock.headers.getSetCookie?.() || [
      freshUnlock.headers.get("set-cookie"),
    ]
  ).find((value) => value?.startsWith("mydiary_entry_unlock="));
  const freshUnlockCookie = freshUnlockSetCookie.split(";", 1)[0];
  const logout = await request("/api/auth/logout", {
    method: "POST",
    cookie: ownerCookie,
  });
  assert.equal(logout.status, 200);
  assert.match(
    logout.headers.getSetCookie?.().join("; ") ||
      logout.headers.get("set-cookie"),
    /mydiary_entry_unlock=.*Path=\/api\/entries/
  );
  const loginAgain = await request("/api/auth/login", {
    method: "POST",
    requestIp: "203.0.113.74",
    body: { email: emailG, password },
  });
  assert.equal(loginAgain.status, 200);
  const newSessionCookie = readSessionCookie(loginAgain);
  assert.equal(
    (
      await request(`/api/entries/${entry._id}`, {
        cookie: `${newSessionCookie}; ${freshUnlockCookie}`,
      })
    ).status,
    423
  );
});
