ar# Web3Nova Academy Portal — API Reference

Base URL (dev): `http://localhost:3012` · prod: `https://<render-app>.onrender.com`
Frontend reads `NEXT_PUBLIC_API_BASE`; CORS allows `http://localhost:3000` and `http://localhost:3001`.
Swagger UIs: `GET /api-docs` (all), `GET /v2/docs` (V2 only).

## Conventions

- All requests/responses are JSON (`Content-Type: application/json`) except file uploads (`multipart/form-data`).
- Errors always return `{ "error": "<message>" }` with an appropriate 4xx/5xx status.
- Admin/student routes require a JWT in `Authorization: Bearer <token>`. Login/register return the token.
- V2 tokens carry `ver: 2`; admin (V1) and student (V2) sessions are separate tables of users, don't mix tokens.
- V2 student login is rate-limited to **10 attempts / 15 min**; register to **20 / 15 min**.

### V2 identity rules (`src/services/v2-identity.js`)

| Field | Rule |
|---|---|
| `studentName` | 3–30 chars, `/^[a-z0-9][a-z0-9._]{2,29}$/` (lowercase, `.` or `_` separators), unique |
| `password` | 6–72 chars |
| `expectation` | 10–600 chars |
| `email` | optional on self-register; if omitted a `studentName@web3nova.app` placeholder is used |

### Points model

- Every student starts at `0` points.
- Each `AITest` (e.g. "Knowledge Check — <Course>") is **one attempt per student** (409 on resubmit).
- Score = `scoreMCQ(correctAnswers, answers)` → `0..100` percentage; score is **added** to `student.points`.
- Leaderboard only includes students with `points > 0`; ties break by earlier first attempt (`AITestAttempt`).

---

## V2 — Student auth

### `POST /v2/auth/register` — self-enrol (intake)
Multipart: `studentName`, `password`, `expectation`, `courseId`, optional `fullName`, `email`, `cohortId` + `image` (≤5MB jpg/png/webp, required). Avatar upload uses Cloudinary — returns **503** until `CLOUDINARY_*` env is configured.
**201**
```json
{ "token": "<jwt>", "user": { "id": "...", "name": "...", "studentName": "...", "email": "...", "role": "STUDENT", "imageUrl": "...", "expectation": "...", "points": 0, "cohortId": "cmuz1ow5m...", "courseId": "cmuz3sji...", "createdAt": "2026-09-08T19:11:34.000Z" } }
```
Errors: `400` invalid fields · `404` cohort/course missing · `409` studentName/email taken · `503` uploads disabled.

### `POST /v2/auth/login` — student login
```json
{ "studentName": "ada.obi", "password": "ada" }
```
**200**: `{ "token": "<jwt>", "user": <publicUser as above> }`
**401** invalid credentials · **403** `"Use the admin login for this account"` (non-STUDENT).

### `GET /v2/auth/me` — current profile (auth)
**200**: publicUser fields plus `"cohort": {id, name}` and `"course": {id, name, description, imageUrl, level, durationWeeks}`.

### `PATCH /v2/auth/me` — update profile (auth, multipart optional)
Any of: `expectation`, `password`, `fullName`, `image` (≤5MB). **200**: `{ "user": publicUser }`. **400** if nothing to update or Cloudinary unconfigured.

---

## V2 — Courses

### `GET /v2/courses` — public intake catalogue
Query: `cohortId` (optional; defaults to active intake). **200**: `{ "cohort": {id, name, startDate, endDate}, "courses": [{ id, name, description, imageUrl, level, durationWeeks, status, courseCode, curriculum?, _count: {students, materials, teachings, aiTests} }] }`

### `GET /v2/courses/:id` — course detail (public)
`404` if unknown course.

### `GET /v2/courses/:id/library` — student library (auth)
Requires enrolled student (course matches). **200**: course + `materials[]` (published, visible).

---

## V2 — Leaderboard (public)

### `GET /v2/leaderboard`
Query: `top` (1–200, default 50), `courseId` (optional filter), `cohortId` (optional; default active intake).
**200**:
```json
{ "cohort": { "id": "...", "name": "Intake 2026 Q4" },
  "total": 2,
  "entries": [ { "rank": 1, "id": "...", "name": "Ada Obi", "imageUrl": null,
                 "courseId": "...", "courseName": "Solidity Foundations",
                 "points": 150, "testsTaken": 0 } ] }
```
`rank` = 1-based index after tie-break (points desc, then earliest first attempt).

---

## V2 — Tests (student)

All require a student JWT; a test is only visible/answerable by students of its course.

### `GET /v2/tests`
**200**: `[{ id, title, description, maxScore, opensAt, closesAt, status?, questionsCount, _count: {attempts}, taken: bool, score: number|null }]` — `taken`/`score` only for the calling student.

### `GET /v2/tests/:id` — test detail (auth)
**200**: `{ id, title, description, maxScore, questions: [{ q, options: string[] }], taken, score }` — answers keys are hidden.
**404** unknown · **403** not your course / not published / not open.

### `POST /v2/tests/:id/submit` — take the test (auth)
```json
{ "answers": { "0": "B", "1": "A", "2": "A", "3": "C", "4": "A" } }
```
**200**: `{ "score": 100, "total": 5, "attempt": "<attemptId>", "points": 100 }` (points = score; student `points` incremented immediately).
**400** `answers required` / malformed test · **403** not your course / not published / not open · **409** `"You already took this test — one attempt only"`.

---

## V2 — Onboarding (first login, student)

All require a student JWT. The frontend sends every student who has no `onboardedAt` to `/welcome`.

| Method | Path | Notes |
|---|---|---|
| GET | `/v2/onboarding` | `{ user, cohort, course, extraCourses[], availableCourses[], onboardedAt, profileCompletedAt, profileBonus, earlyBirdSlotsLeft, firstTestUnlocksAt, uploadsEnabled }` |
| PUT | `/v2/onboarding/courses` | `{ courseIds: [] }` — replaces the student's **extra** courses (same intake only; main course is `User.courseId`). Extra courses unlock their library + knowledge checks. |
| POST | `/v2/onboarding/profile` | Multipart: `image` (required unless they already have one, or uploads are off), `expectation` (required if missing), optional `fullName`. Awards the one-time bonus: **first 10 students in the intake get 200 points, everyone after gets 150**. Returns status + `awarded`, `rank`. Repeat calls update the profile but never re-award. |
| POST | `/v2/onboarding/complete` | Sets `onboardedAt` (idempotent). `firstTestUnlocksAt = onboardedAt + 24h`. |

`POST /v2/onboarding/profile` also takes `gender` (`MALE`|`FEMALE`, required once) — it picks the welcome anthem.

### Bonus task — invite friends to the 7-day boot camp (+100 on approval)

| Method | Path | Notes |
|---|---|---|
| GET | `/v2/tasks/invite` (student) | `{ task, points: 100, state: NOT_STARTED\|PENDING\|APPROVED\|REJECTED, latest }` |
| POST | `/v2/tasks/invite/proof` (student) | Multipart `image` (screenshot ≤8MB). **409** if a proof is pending or already approved. |
| GET | `/v2/admin/proofs?status=PENDING` (admin) | `{ pending, proofs[] }` with student info. Course admins only see their course. |
| PATCH | `/v2/admin/proofs/:id` (admin) | `{ action: "approve"\|"reject", note? }`. Approve adds 100 points — once per student, guarded against double approval. |

**First-test lock:** a student with no test attempts gets **403** `{ error, unlocksAt }` from `GET /v2/tests/:id` and `POST /v2/tests/:id/submit` until 24h after `onboardedAt` (or until they onboard). `GET /v2/tests` includes `lockedUntil` / `lockReason` per test.

**Leaderboard ties** now break by whoever earned points first (first test attempt or profile bonus).

---

## V2 — Admin (courses, materials)

Requires **ADMIN** JWT (V1 admin token): `POST /auth/login`, role `ADMIN`.

| Method | Path | Notes |
|---|---|---|
| GET | `/v2/admin/courses` | List courses (any cohort) with `_count` |
| POST | `/v2/admin/courses` | Multipart: `name`, `description`, `level`, `durationWeeks`, `cohortName`(or id), `courseCode`, `status`, optional `image` |
| PATCH | `/v2/admin/courses/:id` | Multipart, same fields (partial) |
| DELETE | `/v2/admin/courses/:id` | Also removes course materials |
| GET | `/v2/admin/courses/:id/materials` | List materials for a course |
| POST | `/v2/admin/courses/:id/materials` | Multipart: `title`, `category` (`MATERIAL`\|`RECORDING`), `file` |
| DELETE | `/v2/admin/materials/:id` | Remove a material |

### `POST /v2/tests/admin/tests` — create/publish a test (ADMIN)
```json
{ "title": "Knowledge Check — AI Automation", "description": "...", "courseId": "...",
  "questions": [ { "q": "...", "options": ["...","...","...","..."], "correct": "B" },
                 { "q": "...", "options": ["..."], "correct": "A" }, /* ... */ ] }
```
`questions` must have ≥1 question; each needs 2–6 options with one `correct` that exists in options. Optional `status` (`DRAFT`|`PUBLISHED`), `opensAt`, `closesAt`. **201**: created test. **400** invalid payload · **403** admin only.

### `GET /v2/tests/admin/tests` — list tests (ADMIN)
**200**: all tests with `_count.attempts`.

---

## V1 — Legacy endpoints (admin portal + V1 students)

Admin login: `POST /auth/login` `{ "email", "password" }` → `{ token, user }`.

### V1 Admin — `Authorization: Bearer <adminToken>`
| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/cohorts` | Create cohort |
| GET | `/admin/cohorts` | List cohorts |
| POST | `/admin/courses` | Create course (JSON) |
| GET | `/admin/courses` | List courses |
| DELETE | `/admin/courses/:id` | Delete course |
| POST | `/admin/admins` · `/admin/students` · `/admin/students/bulk` | Create admin / student / bulk import (CSV/JSON) |
| GET | `/admin/admins` · `/admin/students` | List admins / students |
| DELETE | `/admin/admins/:id` · `/admin/students/:id` | Delete |
| POST | `/admin/materials` | Upload material + file |
| GET | `/admin/materials` | List materials |
| DELETE | `/admin/materials/:id` | Delete material |
| POST | `/admin/attendance/sessions` | Open a session |
| PATCH | `/admin/attendance/sessions/:id/close` | Close session |
| GET | `/admin/attendance/sessions` · `/admin/attendance` | Session / attendance lists |
| POST | `/admin/curriculum/seed/:cohortId/:courseId` | Seed curriculum weeks |
| GET | `/admin/curriculum` · PATCH `/admin/curriculum/:id` | Manage curriculum |
| POST | `/admin/curriculum/:id/assignment` · PATCH `/admin/assignments/:id` | Create/update assignment (+ question doc) |
| GET | `/admin/assignments` · `/admin/assignments/:id/submissions` | Lists + submissions |
| PATCH | `/admin/submissions/:id/grade` | Grade a submission |
| POST | `/admin/assessments` · PATCH `/admin/assessments/:id` | Create/update assessment |
| POST | `/admin/assessments/:id/paper` · `/admin/assessments/:id/upload-questions` | Upload paper / questions |
| GET | `/admin/assessments` · `/admin/assessments/:id/results` | Lists + results |
| PATCH | `/admin/assessments/results/:id/score` | Score a result |
| GET | `/admin/payments` · `/admin/payments/summary` · `/admin/payments/unpaid` | Payment records & summaries |

### V1 Student — `Authorization: Bearer <studentToken>`
| Method | Path | Purpose |
|---|---|---|
| GET | `/student/materials` | Student's materials |
| POST | `/student/attendance/check-in` | Check in (QR/completion of session) |
| GET | `/student/attendance` | My attendance |
| GET | `/student/curriculum` | My curriculum |
| GET | `/student/assignments` · `/student/assignments/:id` | Assignment list / detail |
| POST | `/student/assignments/:id/submit` | Submit answer + file |
| GET | `/student/assessments` · `/student/assessments/:id` | Assessment list / detail |
| POST | `/student/assessments/:id/submit` (JSON) · `/student/assessments/:id/submit-file` (file) | Submit assessment |
| GET | `/student/grades` | All my grades |

### Payments (unauthenticated webhook-style)
`GET /payments/status` · `POST /payments/initiate` · `POST /payments/verify`.

---

## Data model (Prisma) — key tables

`Cohort` · `Course` · `Enrollment` (extra courses) · `User` (role `ADMIN`/`TUTOR`/`STUDENT`, V2 fields `studentName`, `expectation`, `points`, `imagePublicId`, `courseId`, `cohortId`) · `Curriculum` · `Material` (category `MATERIAL`/`RECORDING`) · `AttendanceSession`/`Attendance` · `Assignment`/`Submission` · `Assessment`/`AssessmentResult` · `Payment` · `Teaching` · `AITest`/`AITestAttempt` (V2 tests) · `Certificate`.

Migrations: `prisma/migrations/20261007000000_v2_intake` (V2 fields) · `20261008000000_v2_tests` (tests + attempts) · `20261009000000_v2_onboarding` (onboarding fields + Enrollment) · `20261010000000_v2_tasks` (gender + TaskProof). Regenerate client after schema edits: `npx prisma generate`.

## Frontend map
- `/` landing (leaderboard carousel) → `/login`
- `/login` — V2 student login (username + password) OR V1 email (admin) + dev backdoor
- `/student` — V2 profile (course, points, rank) + V1 stats
- `/student/diagnostic` — take the course Knowledge Check
- `/leaderboard` — public podium + table
- `/admin/*` — V1 admin portal