# Web3Nova V2 — How Courses Work

Everything V2 lives under `/v2/*` in `cohort-portal` (Express + Prisma + Turso).
V2 courses are the backbone of the new-intake flow: student **registers → picks a
course → gets a tutor and a library** of recordings + materials.

---

## 1. Concepts

| Concept | What it is | Where it lives |
|---|---|---|
| **Intake cohort** | A training window (e.g. *Intake 2026 Q4*). One cohort = one "batch" of 200+ students. | `Cohort` table (`startDate` / `endDate`) |
| **V2 Course** | A course inside an intake: name, description, level, duration, image. | `Course` table |
| **Enrolment** | A student's `cohortId` + `courseId` on their `User` row. Students pick exactly **one** course at registration. | `User` table |
| **Library** | All files of a course, split into **recordings** (`category = RECORDING`) and **materials** (`category = MATERIAL`). | `Material` table |

Course ↔ intake is strict: a course belongs to one `cohortId`, and registration only
offers courses from the active intake.

---

## 2. How the pieces fit

```
 Admin                                  Student
─────────────────                      ─────────────────────────────
 1. Create intake cohort      │         3. POST /v2/auth/register
    (start/end dates)        │            (photo + expectation + courseId)
 2. Create course(s) in it   │         4. GET /v2/courses/:id/library
    + upload materials       │            (recordings + materials)
                             │
```

A student is "enrolled in a course" when `User.courseId` is set. From that point the
student can open their course library; materials are **scoped to their course only**.

---

## 3. Data model

### `Course` (additive fields on the V1 table)
| Field | Type | Notes |
|---|---|---|
| `name` | String | required, unique per cohort |
| `description` | String? | shown on course card |
| `level` | String? | e.g. `Beginner`, `Intermediate` |
| `durationWeeks` | Int? | e.g. `8` |
| `imageUrl` / `imagePublicId` | String? | Cloudinary cover image |
| `cohortId` | String | which intake it belongs to |

### `Material`
| Field | Type | Notes |
|---|---|---|
| `title` | String | required |
| `type` | String | derived from the file: `video`, `pdf`, `image`, `slides`, `doc`, … |
| `category` | String | **`MATERIAL`** (default) or **`RECORDING`** — this is the library split |
| `cloudinaryUrl` / `publicId` | String | uploaded file |
| `cohortId` / `courseId` | String | scope |
| `curriculumId` | String? | optional link to a V1 week |

### `User` (relevant to courses)
`courseId`, `cohortId`, `studentName`, `imageUrl`, `expectation`, `points`.

---

## 4. Endpoints

All `Authorization: Bearer <token>`. Errors: `{ "error": "message" }`.

### Public — course catalogue (register page)
| Method + path | What it does |
|---|---|
| `GET /v2/courses` | Courses of the **active intake** (override with `?cohortId=`). Returns `{ cohort, courses[] }` with student/material/teaching/test counts. |
| `GET /v2/courses/:id` | Course detail + curriculum outline. |

```bash
curl -s http://localhost:3012/v2/courses
```

### Student — enrolment & library (JWT required)
| Method + path | What it does |
|---|---|
| `POST /v2/auth/register` | Enrols a student: picks `courseId`. Photo required (≤5MB, image), expectation 10–600 chars. Returns `{ token, user }`. |
| `GET /v2/courses/:id/library` | **Enrolled students only** (403 otherwise). Returns `{ course, recordings[], materials[] }`, each item `{ id, title, description, category, type, cloudinaryUrl, uploadedAt }`. |

```bash
TOKEN=$(curl -s -X POST localhost:3012/v2/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"studentName":"ada.obi","password":"ada"}' | jq -r .token)

curl -s localhost:3012/v2/courses/<courseId>/library -H "Authorization: Bearer $TOKEN"
```

### Admin — manage courses & materials (ADMIN role; structure writes = super admin)
| Method + path | What it does |
|---|---|
| `GET /v2/admin/courses` | All courses (tutors see only their own). |
| `POST /v2/admin/courses` | Create (super admin). Multipart: `name*`, `cohortId?`, `description?`, `level?`, `durationWeeks?`, `image?`. Missing `cohortId` → active intake. |
| `PATCH /v2/admin/courses/:id` | Update fields / replace image (super admin). |
| `DELETE /v2/admin/courses/:id` | Delete course + Cloudinary assets (super admin). |
| `GET /v2/admin/courses/:id/materials` | List all materials/recordings. |
| `POST /v2/admin/courses/:id/materials` | Upload (tutor can, own course). Multipart: `title*`, `file*`, `category?`, `description?`, `curriculumId?`. `category = MATERIAL` or `RECORDING`. |
| `DELETE /v2/admin/materials/:id` | Delete + remove Cloudinary asset (super admin / owning tutor). |

```bash
ATOKEN=$(curl -s -X POST localhost:3012/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@web3nova.dev","password":"secret123"}' | jq -r .token)

# create a course in the active intake
curl -s -X POST localhost:3012/v2/admin/courses -H "Authorization: Bearer $ATOKEN" \
  -F name='Solidity Foundations' -F level=Beginner -F durationWeeks=8

# upload a recording to it
curl -s -X POST localhost:3012/v2/admin/courses/<courseId>/materials \
  -H "Authorization: Bearer $ATOKEN" \
  -F title='Week 1 — Setup' -F category=RECORDING -F file=@lesson1.mp4
```

---

## 5. Rules & behaviour

- **One cohort at a time.** `GET /v2/courses` and course writes pick the intake cohort by: running → next upcoming → most recent past. Admin can pass `cohortId` to override.
- **Registration is the enrolment.** There is no separate "join course" call; choosing the course at registration sets `User.courseId`. (A user can't switch courses post-registration yet — teammate/next iteration.)
- **Library is per-course and gated.** `403` for non-enrolled students, even with a valid token.
- **Categorisation is the split.** Uploads default to `MATERIAL`; set `category=RECORDING` for recorded class videos. The library endpoint filters on that.
- **File types** are derived from the mimetype (`video/mp4` → `video`, `application/pdf` → `pdf`, …).
- **Cloudinary required** for uploads/photo; without credentials, those calls return `503`.
- **V1 untouched.** The old `/admin/courses`, `/student/materials`, etc. keep working as before — V2 adds the intake-cohort concept, course cards (image/level/weeks), and the recordings-vs-materials library.

---

## 6. Current demo data (local/Turso)

| Item | Value |
|---|---|
| Intake | `Intake 2026 Q4` (2026-10-01 → 2027-01-31) |
| Courses | `Solidity Foundations` (Beginner, 8w) + the 6 intake courses: Web Development, UI/UX, Mobile App Development, AI Automation, AI Prompting, Blockchain Development |
| Knowledge Checks | 1 published per course (5 MCQs each) — `Knowledge Check — <Course>` |
| Student | `ada.obi` (Ada Obi) → Solidity, 150 pts |
| Intake students | 238 imported from the signup sheets (real names) — see §8 |
| Tutor | `sarah.adebayo@web3nova.dev` → Solidity |

Rerun `node scripts/seed-v2-demo.js` to recreate the 6 courses + knowledge checks + demo scores
(idempotent). The demo participants (8 `@students.web3nova.app` users + `tester-1`) have been
**deleted** — do not recreate them for production data.

---

## 8. Intake import (the 238 students)

Real signup data was transcribed into `scripts/data/sheet1.tsv` (Google Form A, richer fields:
level/expectation/location) and `scripts/data/sheet2.tsv` (Google Form B: age + hours). `node scripts/import-intake.js [--reset]`:

1. parses both sheets and **dedupes by normalized email** — Sheet A wins the email, otherwise earliest
   submission per sheet;
2. maps each signup skill → intake course (Web→Web Development, UI/UX→UI/UX, AI & Automation→AI
   Automation, Ai Prompting→AI Prompting, Blockchain→Blockchain Development);
3. generates a unique `studentName` (`first.last`, lowercased, `-2` suffix on collision) and a
   **password = first name lowercase** (bcrypt-hashed in DB);
4. the 4 broken emails (`emm`/`bona`/`enio`/`Ika`) get placeholder `first.last@rebuild.web3nova.app`;
5. sets `createdAt` to the form's submission timestamp, `points: 0`, course + intake cohort;
6. writes `scripts/data/intake-credentials.csv` (studentName, email, **plaintext password**, name —
   **gitignored, do not commit**) and `scripts/data/intake-report.csv` (phone, course, timestamps);
7. `--reset` deletes previously-imported rows (attempts first) before re-importing.

Instruct students: **log in at the Academy portal with their `studentName` username + first-name
lowercase password**, take the Knowledge Check (one attempt), then check the leaderboard.

---

## 7. Where the code lives

```
cohort-portal/
├── prisma/schema.prisma              # Course, Material (+category), User fields, AITest(+Attempt)
├── prisma/migrations/20261007000000_v2_intake/migration.sql
├── prisma/migrations/20261008000000_v2_tests/migration.sql
├── src/routes/v2/courses.js          # catalogue, detail, library
├── src/routes/v2/admin.js            # course CRUD + materials upload
├── src/routes/v2/auth.js             # register (enrolment) + login + profile
├── src/routes/v2/tests.js            # admin tests CRUD + student take/submit
├── src/routes/v2/leaderboard.js      # PUBLIC GET /v2/leaderboard (top + tie-break)
├── src/services/v2-identity.js       # intake picker, name/password rules, type mapping
├── src/services/mcq-score.js         # scoreMCQ(correctAnswers, answers) → 0-100 %
└── scripts/seed-v2-demo.js           # 6 courses + knowledge checks + demo scores
├── scripts/import-intake.js           # real signups → students + credentials CSV
└── scripts/data/                      # sheet1.tsv, sheet2.tsv, intake-credentials.csv, intake-report.csv
```

Docs UIs: `http://localhost:3012/api-docs` (all) · `http://localhost:3012/v2/docs` (V2 only).