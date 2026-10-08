# Web3Nova V2 — Plan

Version 2 of the portal for the new intake (200+ students). V1 keeps running untouched;
everything V2 lives under `/v2/*` on the same database, scoped to the **new intake cohort**.

---

## 1. Student journey

```
Register ──► Login ──► Course dashboard
   │                      │
   │  photo, expectation, │
   │  choose course       ▼
   │                 Teachings (next live sessions)
   │                      │
   │                      ▼
   │                 Recordings & Materials (course library)
   │                      │
   │                      ▼
   │                 AI Test ──► Leaderboard ──► Certificate
```

| Step | What happens | Owner |
|---|---|---|
| 1. Register | `studentName` + password + photo + expectation + course choice | **this pass** |
| 2. Login | `studentName` + password → JWT | **this pass** |
| 3. Courses | Browse intake courses, open course | **this pass** |
| 4. Library | Course recordings + materials (grouped) | **this pass** |
| 5. Teachings | Upcoming/live class sessions | teammate |
| 6. AI Test | AI-generated test, attempt, score | teammate |
| 7. Leaderboard | Ranking from `User.points` | teammate |
| 8. Certificate | Issue/verify on completion | teammate |

---

## 2. Data model changes

All changes are **additive** (new columns with defaults / new tables) — no V1 behaviour changes.

### `User`
| Column | Type | Notes |
|---|---|---|
| `studentName` | `String? @unique` | login handle, stored lowercase |
| `imageUrl`, `imagePublicId` | `String?` | avatar from register (Cloudinary) |
| `expectation` | `String?` | "what I expect to gain", set at register |
| `points` | `Int @default(0)` | leaderboard currency, +score per AI test |

`email` stays `NOT NULL` (V1 constraint) — V2 register auto-generates
`<studentName>@students.web3nova.app` when no email is supplied.

### `Course`
`description`, `imageUrl`, `imagePublicId`, `level`, `durationWeeks` (all optional) —
enough for a course card + detail page.

### `Material`
`category String @default("MATERIAL")` — `MATERIAL` or `RECORDING`. This is what splits
the course library into "Recordings" vs "Materials". V1 rows default to `MATERIAL`.

### New models (schema created now, routes are teammate's)

```prisma
Teaching      { title, description?, startsAt, endsAt, meetingUrl?, status = "SCHEDULED",
                courseId, cohortId }                // next teachings / live sessions

AITest        { title, description?, maxScore, opensAt?, closesAt?, status,
                courseId, cohortId, attempts[] }    // AI-generated test

AITestAttempt { testId, studentId, score?, answers?, feedback?, submittedAt }
                @@unique([testId, studentId])

Certificate   { studentId, courseId, code @unique, status = "ISSUED", issuedAt }
                @@unique([studentId, courseId])
```

Leaderboard needs no table: `SELECT studentName, name, points FROM User
WHERE role = 'STUDENT' AND cohortId = ? ORDER BY points DESC`.

---

## 3. Endpoint contracts (this pass)

Base: everything below is prefixed `/v2`. Errors are always `{ "error": "string" }`.

### Auth — `/v2/auth`

**`POST /v2/auth/register`** — `multipart/form-data`
| field | required | rules |
|---|---|---|
| `studentName` | ✅ | 3–30 chars, `a-z0-9._`, unique, lowercase-stored |
| `password` | ✅ | ≥ 6 chars (bcrypt-hashed) |
| `expectation` | ✅ | 10–600 chars |
| `courseId` | ✅ | must belong to the intake cohort |
| `image` | ✅ | image file, ≤ 5MB, uploaded to Cloudinary |
| `cohortId` | – | defaults to active intake cohort |
| `fullName` | – | display name, defaults to `studentName` |
| `email` | – | must be unique if given, else auto-generated |

→ `201 { token, user }`, rate limited 20/15min/IP.

**`POST /v2/auth/login`** — `{ studentName, password }` → `200 { token, user }`, 10/15min/IP.
JWT payload: `{ id, studentName, role, cohortId, courseId, ver: 2 }`, 7 days.

**`GET /v2/auth/me`** — profile incl. `expectation`, `imageUrl`, `points`, course.

**`PATCH /v2/auth/me`** — optional `expectation`, `password`, `image` (file).

### Courses — `/v2/courses`

| method | path | auth | returns |
|---|---|---|---|
| GET | `/v2/courses` | public | intake courses (override `?cohortId=`) with counts |
| GET | `/v2/courses/:id` | public | course detail + counts |
| GET | `/v2/courses/:id/library` | student, enrolled | `{ course, recordings[], materials[] }` |

Library rows: `id, title, description?, category, type, cloudinaryUrl, uploadedAt,
curriculumId?` ordered newest-first. Non-enrolled students get `403`.

### Admin — `/v2/admin` (ADMIN role; writes are super-admin only)

| method | path | notes |
|---|---|---|
| GET | `/admin/courses` | all cohorts, counts |
| POST | `/admin/courses` | `multipart` if `image` present: `name, cohortId?, description?, level?, durationWeeks?` |
| PATCH | `/admin/courses/:id` | any of the above + replace `image` |
| DELETE | `/admin/courses/:id` | cascades |
| GET | `/admin/courses/:id/materials` | full list |
| POST | `/admin/courses/:id/materials` | `multipart`: `file*, title*, category?, description?, curriculumId?`; `type` derived from mimetype |
| DELETE | `/admin/materials/:id` | removes Cloudinary asset too |

`category` = `MATERIAL` (default) or `RECORDING`.

---

## 4. Ownership split

**Done in this pass**
- `prisma/schema.prisma` + migration `20261007000000_v2_intake`
- `src/services/v2-identity.js` (name/password/intake-cohort helpers)
- `src/routes/v2/auth.js`, `src/routes/v2/courses.js`, `src/routes/v2/admin.js`
- mounts in `index.js`, Swagger tags/paths, `tests/v2.test.js`
- migration `20261008000000_v2_tests` (AITest `questions`/`correctAnswers` TEXT JSON)
- `src/routes/v2/tests.js` — admin create/list; student take + single-attempt submit → `points += score`
- `src/routes/v2/leaderboard.js` — **public** `GET /v2/leaderboard` (points desc, tie-break = earliest attempt)
- seed `scripts/seed-v2-demo.js` — 6 courses + per-course "Knowledge Check" + 8 demo participants (delete to wipe)

**Teammate builds next** (schema already in place)
- `GET/POST /v2/teachings` — student schedule (next teachings), admin CRUD
- `/v2/certificates` — eligibility, issue (`code`), public verify endpoint
- `/v2/me/overview` — dashboard aggregate: next teaching, library counts, rank, cert status

Knowledge Check rules (shop with participants): **one attempt per test**, score = `%` correct via
`src/services/mcq-score.js`, points = rounded percentage, tie-break = earliest `submittedAt`.

Conventions to keep: Express router per domain, `authenticate` + role middleware from
`src/middleware/auth.js`, `prisma` from `src/db.js`, `uploadBuffer/deleteFile` from
`src/services/cloudinary.js`, errors as `{ error }`, Swagger entries in `src/swagger.js`.

---

## 5. Frontend pages (for reference)

`/register` (photo capture + expectation + course picker) · `/login` (studentName) ·
`/dashboard` · `/teachings` · `/library` (recordings | materials tabs) · `/tests` ·
`/leaderboard` · `/certificate/:code`

Login hint copy: *"Your studentName is the handle you chose at registration."*
