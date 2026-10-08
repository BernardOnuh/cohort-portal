const bearerAuth = {
  BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
}

const secured = [{ BearerAuth: [] }]

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Academic Portal API',
    version: '1.0.0',
    description:
      'Web3Nova cohort portal — auth, admin, and student endpoints. ' +
      'Login first to get a JWT, then click **Authorize** and paste it.',
  },
  servers: [
    { url: 'http://localhost:3012', description: 'Local' },
    { url: 'https://cohort-portal-cmhj.onrender.com', description: 'Production' },
  ],
  components: {
    securitySchemes: bearerAuth,
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
  tags: [
    { name: 'Auth' },
    { name: 'Admin — Cohorts' },
    { name: 'Admin — Courses' },
    { name: 'Admin — Curriculum' },
    { name: 'Admin — Assignments' },
    { name: 'Admin — Assessments' },
    { name: 'Admin — Admins' },
    { name: 'Admin — Students' },
    { name: 'Admin — Materials' },
    { name: 'Admin — Attendance' },
    { name: 'Admin — Payments' },
    { name: 'Student — Curriculum' },
    { name: 'Student — Assignments' },
    { name: 'Student — Assessments' },
    { name: 'Student — Materials' },
    { name: 'Student — Attendance' },
    { name: 'Student — Grades' },
    { name: 'Payments' },
    { name: 'V2 — Auth' },
    { name: 'V2 — Courses' },
    { name: 'V2 — Tests' },
    { name: 'V2 — Leaderboard' },
    { name: 'V2 — Admin' },
  ],
  paths: {

    // ── Auth ────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login (all roles)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', example: 'john.doe@web3nova.org' },
                  password: { type: 'string', example: 'john' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'JWT token + user object' },
          401: { description: 'Invalid credentials' },
          429: { description: 'Rate limited' },
        },
      },
    },

    // ── Cohorts ─────────────────────────────────────────────────
    '/admin/cohorts': {
      get: {
        tags: ['Admin — Cohorts'],
        summary: 'List cohorts',
        security: secured,
        responses: { 200: { description: 'Array of cohorts with student/course counts' } },
      },
      post: {
        tags: ['Admin — Cohorts'],
        summary: 'Create cohort (super admin)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'startDate', 'endDate'],
                properties: {
                  name:      { type: 'string', example: 'Cohort III' },
                  startDate: { type: 'string', format: 'date', example: '2026-05-07' },
                  endDate:   { type: 'string', format: 'date', example: '2026-08-07' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created cohort' }, 403: { description: 'Super admin only' } },
      },
    },

    // ── Courses ─────────────────────────────────────────────────
    '/admin/courses': {
      get: {
        tags: ['Admin — Courses'],
        summary: 'List courses',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Array of courses with counts' } },
      },
      post: {
        tags: ['Admin — Courses'],
        summary: 'Create course (super admin)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'cohortId'],
                properties: {
                  name:     { type: 'string', example: 'Web Development' },
                  cohortId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created course' }, 403: { description: 'Super admin only' } },
      },
    },
    '/admin/courses/{id}': {
      delete: {
        tags: ['Admin — Courses'],
        summary: 'Delete course (super admin)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Curriculum ───────────────────────────────────────────────
    '/admin/curriculum': {
      get: {
        tags: ['Admin — Curriculum'],
        summary: 'List curriculum weeks',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' } },
          { name: 'courseId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Weeks with assignment and materials' } },
      },
    },
    '/admin/curriculum/seed/{cohortId}/{courseId}': {
      post: {
        tags: ['Admin — Curriculum'],
        summary: 'Seed 12 weeks for a course (super admin)',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'courseId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 201: { description: 'Array of 12 curriculum week objects' } },
      },
    },
    '/admin/curriculum/{id}': {
      patch: {
        tags: ['Admin — Curriculum'],
        summary: 'Update week title / description',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title:       { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated week' } },
      },
    },

    // ── Assignments (admin) ──────────────────────────────────────
    '/admin/assignments': {
      get: {
        tags: ['Admin — Assignments'],
        summary: 'List assignments',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' } },
          { name: 'courseId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Array of assignments ordered by openAt desc' } },
      },
    },
    '/admin/curriculum/{id}/assignment': {
      post: {
        tags: ['Admin — Assignments'],
        summary: 'Create assignment for a curriculum week',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Curriculum week ID' }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['title', 'description'],
                properties: {
                  title:                  { type: 'string' },
                  description:            { type: 'string' },
                  questionText:           { type: 'string' },
                  questionDoc:            { type: 'string', format: 'binary' },
                  allowedSubmissionTypes: { type: 'string', example: '["url","pdf","image"]' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created assignment' }, 409: { description: 'Already exists for this week' } },
      },
    },
    '/admin/assignments/{id}': {
      patch: {
        tags: ['Admin — Assignments'],
        summary: 'Update assignment',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  title:                  { type: 'string' },
                  description:            { type: 'string' },
                  questionText:           { type: 'string' },
                  questionDoc:            { type: 'string', format: 'binary' },
                  allowedSubmissionTypes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated assignment' } },
      },
    },
    '/admin/assignments/{id}/submissions': {
      get: {
        tags: ['Admin — Assignments'],
        summary: 'List submissions for an assignment',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Submissions with student info, grades, feedback' } },
      },
    },
    '/admin/submissions/{id}/grade': {
      patch: {
        tags: ['Admin — Assignments'],
        summary: 'Set grade and feedback on a submission',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['grade'],
                properties: {
                  grade:    { type: 'number', example: 85 },
                  feedback: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated submission' } },
      },
    },

    // ── Assessments (admin) ──────────────────────────────────────
    '/admin/assessments': {
      get: {
        tags: ['Admin — Assessments'],
        summary: 'List assessments',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' } },
          { name: 'courseId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Array of assessments ordered by dueDate desc' } },
      },
      post: {
        tags: ['Admin — Assessments'],
        summary: 'Create assessment',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'type', 'cohortId', 'courseId', 'dueDate'],
                properties: {
                  title:    { type: 'string', example: 'Week 3 Quiz' },
                  type:     { type: 'string', enum: ['TEST', 'EXAM'], example: 'TEST' },
                  cohortId: { type: 'string' },
                  courseId: { type: 'string' },
                  dueDate:  { type: 'string', format: 'date', example: '2026-05-21' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created assessment with empty questions' } },
      },
    },
    '/admin/assessments/{id}': {
      patch: {
        tags: ['Admin — Assessments'],
        summary: 'Set MCQ questions manually',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        q:       { type: 'string' },
                        options: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated assessment' } },
      },
    },
    '/admin/assessments/{id}/upload-questions': {
      post: {
        tags: ['Admin — Assessments'],
        summary: 'Auto-parse MCQ questions from CSV / PDF / DOCX',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { 200: { description: 'N questions loaded' }, 400: { description: 'Parse error' } },
      },
    },
    '/admin/assessments/{id}/paper': {
      post: {
        tags: ['Admin — Assessments'],
        summary: 'Upload question paper (file_upload assessments)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Assessment with paperUrl set' } },
      },
    },
    '/admin/assessments/{id}/results': {
      get: {
        tags: ['Admin — Assessments'],
        summary: 'List student results for an assessment',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Results with student names, scores' } },
      },
    },
    '/admin/assessments/results/{id}/score': {
      patch: {
        tags: ['Admin — Assessments'],
        summary: 'Set score on a file-upload result',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['score'],
                properties: { score: { type: 'number', example: 78 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated result' } },
      },
    },

    // ── Admins ───────────────────────────────────────────────────
    '/admin/admins': {
      get: {
        tags: ['Admin — Admins'],
        summary: 'List admins/tutors (super admin)',
        security: secured,
        responses: { 200: { description: 'Array of admin accounts' } },
      },
      post: {
        tags: ['Admin — Admins'],
        summary: 'Create tutor account (super admin)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'courseId'],
                properties: {
                  name:     { type: 'string', example: 'Tunde Adeyemi' },
                  email:    { type: 'string', example: 'tunde@web3nova.org' },
                  courseId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created admin (default password = first name lowercase)' } },
      },
    },
    '/admin/admins/{id}': {
      delete: {
        tags: ['Admin — Admins'],
        summary: 'Delete admin (super admin)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Students ─────────────────────────────────────────────────
    '/admin/students': {
      get: {
        tags: ['Admin — Students'],
        summary: 'List students',
        security: secured,
        parameters: [{ name: 'cohortId', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Array of students (tutors scoped to their course)' } },
      },
      post: {
        tags: ['Admin — Students'],
        summary: 'Add single student',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'cohortId', 'courseId'],
                properties: {
                  name:     { type: 'string', example: 'Jane Okonkwo' },
                  email:    { type: 'string', example: 'jane@web3nova.org' },
                  cohortId: { type: 'string' },
                  courseId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created student' } },
      },
    },
    '/admin/students/bulk': {
      post: {
        tags: ['Admin — Students'],
        summary: 'Bulk-enroll students',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['students', 'cohortId', 'courseId'],
                properties: {
                  cohortId: { type: 'string' },
                  courseId: { type: 'string' },
                  students: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name:  { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: '{ created: [], failed: [] }' } },
      },
    },
    '/admin/students/{id}': {
      delete: {
        tags: ['Admin — Students'],
        summary: 'Remove student',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Materials (admin) ────────────────────────────────────────
    '/admin/materials': {
      get: {
        tags: ['Admin — Materials'],
        summary: 'List materials',
        security: secured,
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' } },
          { name: 'courseId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Array of material objects' } },
      },
      post: {
        tags: ['Admin — Materials'],
        summary: 'Upload material',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'title', 'type', 'cohortId', 'courseId'],
                properties: {
                  file:         { type: 'string', format: 'binary' },
                  title:        { type: 'string', example: 'Week 1 Slides' },
                  type:         { type: 'string', example: 'pdf' },
                  cohortId:     { type: 'string' },
                  courseId:     { type: 'string' },
                  curriculumId: { type: 'string', description: 'Optional — attaches to a curriculum week' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Uploaded material with Cloudinary URL' } },
      },
    },
    '/admin/materials/{id}': {
      delete: {
        tags: ['Admin — Materials'],
        summary: 'Delete material (also removes from Cloudinary)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Attendance (admin) ───────────────────────────────────────
    '/admin/attendance/sessions': {
      get: {
        tags: ['Admin — Attendance'],
        summary: 'List attendance sessions',
        security: secured,
        parameters: [{ name: 'cohortId', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Sessions with attendance counts' } },
      },
      post: {
        tags: ['Admin — Attendance'],
        summary: 'Open an attendance session',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['cohortId', 'courseId', 'date', 'allowedIp'],
                properties: {
                  cohortId:  { type: 'string' },
                  courseId:  { type: 'string' },
                  date:      { type: 'string', format: 'date', example: '2026-05-07' },
                  allowedIp: { type: 'string', example: '192.168.1.1' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Active session created' } },
      },
    },
    '/admin/attendance/sessions/{id}/close': {
      patch: {
        tags: ['Admin — Attendance'],
        summary: 'Close an attendance session',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Session closed' } },
      },
    },
    '/admin/attendance': {
      get: {
        tags: ['Admin — Attendance'],
        summary: 'List attendance records',
        security: secured,
        parameters: [
          { name: 'cohortId',  in: 'query', schema: { type: 'string' } },
          { name: 'sessionId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Records with student name/email' } },
      },
    },

    // ── Student — Curriculum ─────────────────────────────────────
    '/student/curriculum': {
      get: {
        tags: ['Student — Curriculum'],
        summary: 'Get all 12 weeks with materials and assignment windows',
        security: secured,
        responses: { 200: { description: 'Curriculum weeks (no grades)' } },
      },
    },

    // ── Student — Assignments ────────────────────────────────────
    '/student/assignments': {
      get: {
        tags: ['Student — Assignments'],
        summary: 'Get currently open assignments',
        security: secured,
        responses: { 200: { description: 'Open assignments only' } },
      },
    },
    '/student/assignments/{id}': {
      get: {
        tags: ['Student — Assignments'],
        summary: 'Get full assignment details',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Assignment with questionText and allowed types' } },
      },
    },
    '/student/assignments/{id}/submit': {
      post: {
        tags: ['Student — Assignments'],
        summary: 'Submit (or re-submit) an assignment',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['submissionType'],
                properties: {
                  submissionType: { type: 'string', enum: ['pdf', 'doc', 'url', 'image', 'video', 'code'] },
                  file:           { type: 'string', format: 'binary' },
                  contentUrl:     { type: 'string', example: 'https://github.com/...' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Submitted successfully' },
          200: { description: 'Submission updated (re-submit)' },
          403: { description: 'Window closed' },
        },
      },
    },

    // ── Student — Assessments ────────────────────────────────────
    '/student/assessments': {
      get: {
        tags: ['Student — Assessments'],
        summary: 'List assessments',
        security: secured,
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['TEST', 'EXAM'] } }],
        responses: { 200: { description: 'Assessments without questions/answers' } },
      },
    },
    '/student/assessments/{id}': {
      get: {
        tags: ['Student — Assessments'],
        summary: 'Get assessment with questions (no correct answers)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Assessment object' } },
      },
    },
    '/student/assessments/{id}/submit': {
      post: {
        tags: ['Student — Assessments'],
        summary: 'Submit MCQ answers (auto-marked, one-shot)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answers'],
                properties: {
                  answers: {
                    type: 'object',
                    additionalProperties: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                    example: { '0': 'A', '1': 'C', '2': 'A' },
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Submitted' }, 409: { description: 'Already submitted' } },
      },
    },
    '/student/assessments/{id}/submit-file': {
      post: {
        tags: ['Student — Assessments'],
        summary: 'Submit file for file-upload assessment',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['submissionType'],
                properties: {
                  submissionType: { type: 'string', enum: ['pdf', 'doc', 'url', 'image', 'video', 'code'] },
                  file:           { type: 'string', format: 'binary' },
                  contentUrl:     { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Submitted' }, 200: { description: 'Updated' }, 403: { description: 'Due date passed' } },
      },
    },

    // ── Student — Materials ──────────────────────────────────────
    '/student/materials': {
      get: {
        tags: ['Student — Materials'],
        summary: 'Get course-level materials (not week-specific)',
        security: secured,
        responses: { 200: { description: 'Array of materials' } },
      },
    },

    // ── Student — Attendance ─────────────────────────────────────
    '/student/attendance/check-in': {
      post: {
        tags: ['Student — Attendance'],
        summary: 'Check in to active session (IP validated)',
        security: secured,
        responses: {
          201: { description: 'Checked in' },
          403: { description: 'Wrong network' },
          404: { description: 'No active session' },
          409: { description: 'Already checked in' },
        },
      },
    },
    '/student/attendance': {
      get: {
        tags: ['Student — Attendance'],
        summary: 'Get own attendance history',
        security: secured,
        responses: { 200: { description: 'Attendance records' } },
      },
    },

    // ── Payments ─────────────────────────────────────────────────
    '/payments/status': {
      get: {
        tags: ['Payments'],
        summary: 'Get payment status and what the student can pay',
        security: secured,
        responses: {
          200: {
            description: 'Current payment record, deadlines, and allowed payment options',
          },
        },
      },
    },
    '/payments/initiate': {
      post: {
        tags: ['Payments'],
        summary: 'Initiate a payment — returns Monnify checkout URL',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentType'],
                properties: {
                  paymentType: {
                    type: 'string',
                    enum: ['full', 'instalment1', 'instalment2'],
                    example: 'full',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'checkoutUrl, transactionReference, ref' },
          400: { description: 'Invalid paymentType' },
          403: { description: 'Payment not allowed at current stage / deadline passed' },
        },
      },
    },
    '/payments/verify': {
      post: {
        tags: ['Payments'],
        summary: 'Verify payment after returning from Monnify checkout',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentReference'],
                properties: {
                  paymentReference: { type: 'string', example: 'MNFY|...' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Payment verified — status and amountPaid updated' },
          402: { description: 'Payment not confirmed by Monnify' },
          404: { description: 'No pending payment record found' },
        },
      },
    },
    '/payments/webhook': {
      post: {
        tags: ['Payments'],
        summary: 'Monnify webhook (called by Monnify, not the frontend)',
        description: 'No auth required. Monnify posts here on SUCCESSFUL_TRANSACTION events. Validated via HMAC-SHA512 signature header.',
        responses: {
          200: { description: 'Acknowledged' },
          401: { description: 'Invalid Monnify signature' },
        },
      },
    },

    // ── Admin — Payments ─────────────────────────────────────────
    '/admin/payments': {
      get: {
        tags: ['Admin — Payments'],
        summary: 'List all payments (admin only)',
        security: secured,
        parameters: [
          {
            name: 'cohortId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by cohort ID',
          },
          {
            name: 'courseId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by course ID',
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['PENDING', 'INSTALMENT_1_PAID', 'COMPLETED'] },
            description: 'Filter by payment status',
          },
        ],
        responses: {
          200: {
            description: 'Array of payment records with student, cohort, and course details',
          },
          403: { description: 'Insufficient permissions' },
        },
      },
    },
    '/admin/payments/summary': {
      get: {
        tags: ['Admin — Payments'],
        summary: 'Get payment statistics and summary (admin only)',
        security: secured,
        parameters: [
          {
            name: 'cohortId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by cohort ID',
          },
          {
            name: 'courseId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by course ID',
          },
        ],
        responses: {
          200: {
            description: 'Payment summary with total, completed, pending counts and collection statistics',
          },
          403: { description: 'Insufficient permissions' },
        },
      },
    },
    '/admin/payments/unpaid': {
      get: {
        tags: ['Admin — Payments'],
        summary: 'Get list of unpaid students (admin only)',
        security: secured,
        parameters: [
          {
            name: 'cohortId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by cohort ID',
          },
          {
            name: 'courseId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by course ID',
          },
        ],
        responses: {
          200: {
            description: 'Array of students with PENDING payment status',
          },
          403: { description: 'Insufficient permissions' },
        },
      },
    },

    // ── Student — Grades ─────────────────────────────────────────
    '/student/grades': {
      get: {
        tags: ['Student — Grades'],
        summary: 'Submission history (grades hidden from students)',
        security: secured,
        responses: { 200: { description: '{ assignments: [], assessments: [] }' } },
      },
    },

    // ══ V2 — new intake ════════════════════════════════════════

    // ── V2 Auth ───────────────────────────────────────────────
    '/v2/auth/register': {
      post: {
        tags: ['V2 — Auth'],
        summary: 'Register a new student (multipart: photo + expectation + course)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['studentName', 'password', 'expectation', 'courseId', 'image'],
                properties: {
                  studentName: { type: 'string', example: 'ada.lovelace' },
                  password:    { type: 'string', format: 'password', example: 'secret123' },
                  expectation: { type: 'string', example: 'I want to ship my first dApp and land a web3 internship.' },
                  courseId:    { type: 'string' },
                  image:       { type: 'string', format: 'binary', description: 'Avatar photo, max 5MB' },
                  cohortId:    { type: 'string', description: 'Defaults to the active intake' },
                  fullName:    { type: 'string', description: 'Display name, defaults to studentName' },
                  email:       { type: 'string', description: 'Optional — auto-generated when omitted' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '{ token, user }' },
          400: { description: 'Validation error' },
          409: { description: 'studentName or email already taken' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/v2/auth/login': {
      post: {
        tags: ['V2 — Auth'],
        summary: 'Login with studentName + password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['studentName', 'password'],
                properties: {
                  studentName: { type: 'string', example: 'ada.lovelace' },
                  password:    { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '{ token, user }' },
          401: { description: 'Invalid credentials' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/v2/auth/me': {
      get: {
        tags: ['V2 — Auth'],
        summary: 'Current student profile (expectation, photo, points, course)',
        security: secured,
        responses: { 200: { description: 'Profile object' }, 401: { description: 'No/invalid token' } },
      },
      patch: {
        tags: ['V2 — Auth'],
        summary: 'Update own profile (expectation, password, fullName, photo)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  expectation: { type: 'string' },
                  password:    { type: 'string', format: 'password' },
                  fullName:    { type: 'string' },
                  image:       { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: { 200: { description: '{ user }' }, 400: { description: 'Nothing to update' } },
      },
    },

    // ── V2 Courses ────────────────────────────────────────────
    '/v2/courses': {
      get: {
        tags: ['V2 — Courses'],
        summary: 'Intake course catalogue (public — used by the register page)',
        parameters: [
          { name: 'cohortId', in: 'query', schema: { type: 'string' }, description: 'Defaults to the active intake' },
        ],
        responses: { 200: { description: '{ cohort, courses[] } with counts' } },
      },
    },
    '/v2/courses/{id}': {
      get: {
        tags: ['V2 — Courses'],
        summary: 'Course detail with counts + curriculum outline',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Course object' }, 404: { description: 'Not found' } },
      },
    },
    '/v2/courses/{id}/library': {
      get: {
        tags: ['V2 — Courses'],
        summary: 'Course library — recordings + materials (enrolled students)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: '{ course, recordings[], materials[] }' },
          403: { description: 'Not enrolled in this course' },
        },
      },
    },

    // ── V2 Diagnostics / Tests ───────────────────────────────
    '/v2/tests': {
      get: {
        tags: ['V2 — Tests'],
        summary: 'Available knowledge tests for my course (student)',
        security: secured,
        responses: { 200: { description: 'Array of tests with taken/score flags' } },
      },
      post: {
        tags: ['V2 — Tests'],
        summary: 'Create a knowledge test (admin)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['courseId', 'title', 'questions'],
                properties: {
                  courseId:    { type: 'string' },
                  title:       { type: 'string', example: 'Knowledge Check — Solidity' },
                  description: { type: 'string' },
                  status:      { type: 'string', enum: ['PUBLISHED', 'DRAFT'], default: 'PUBLISHED' },
                  opensAt:     { type: 'string', format: 'date-time' },
                  closesAt:    { type: 'string', format: 'date-time' },
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        q:       { type: 'string' },
                        options: { type: 'array', items: { type: 'string' } },
                        answer:  { description: 'Correct option letter or index', type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created test' }, 403: { description: 'Admins only / not your course' } },
      },
    },
    '/v2/tests/{id}': {
      get: {
        tags: ['V2 — Tests'],
        summary: 'Take a test — questions without answers (enrolled student)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ title, questions[], taken, score }' }, 403: { description: 'Not your course / closed' } },
      },
    },
    '/v2/tests/{id}/submit': {
      post: {
        tags: ['V2 — Tests'],
        summary: 'Submit answers (single attempt) → score + points',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answers'],
                properties: { answers: { type: 'object', example: { '0': 'B', '1': 'A', '2': 'C' } } },
              },
            },
          },
        },
        responses: { 201: { description: '{ score, total, points }' }, 409: { description: 'Already taken — one attempt only' } },
      },
    },
    '/v2/admin/tests': {
      get: {
        tags: ['V2 — Tests'],
        summary: 'List tests (admin; tutors see their own course)',
        security: secured,
        responses: { 200: { description: 'Array of tests with attempt counts' } },
      },
    },

    // ── V2 Leaderboard ────────────────────────────────────────
    '/v2/leaderboard': {
      get: {
        tags: ['V2 — Leaderboard'],
        summary: 'Public leaderboard — ranked by points (no auth)',
        parameters: [
          { name: 'top', in: 'query', schema: { type: 'integer', default: 50 }, description: '1–200' },
          { name: 'courseId', in: 'query', schema: { type: 'string' }, description: 'Filter by course' },
        ],
        responses: { 200: { description: '{ cohort, total, entries: [{rank, name, points, testsTaken}] }' } },
      },
    },

    // ── V2 Admin ──────────────────────────────────────────────
    '/v2/admin/courses': {
      get: {
        tags: ['V2 — Admin'],
        summary: 'List courses (tutors see only their own)',
        security: secured,
        responses: { 200: { description: 'Array of courses with counts' } },
      },
      post: {
        tags: ['V2 — Admin'],
        summary: 'Create a course (super admin; multipart when image supplied)',
        security: secured,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name:          { type: 'string', example: 'Solidity Foundations' },
                  description:   { type: 'string' },
                  level:         { type: 'string', example: 'Beginner' },
                  durationWeeks: { type: 'integer', example: 8 },
                  cohortId:      { type: 'string', description: 'Defaults to the active intake' },
                  image:         { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created course' },
          403: { description: 'Super admin only' },
          409: { description: 'Duplicate course name in this intake' },
        },
      },
    },
    '/v2/admin/courses/{id}': {
      patch: {
        tags: ['V2 — Admin'],
        summary: 'Update course details (super admin)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated course' }, 403: { description: 'Super admin only' } },
      },
      delete: {
        tags: ['V2 — Admin'],
        summary: 'Delete course and its Cloudinary assets (super admin)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' }, 403: { description: 'Super admin only' } },
      },
    },
    '/v2/admin/courses/{id}/materials': {
      get: {
        tags: ['V2 — Admin'],
        summary: 'List course materials/recordings',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Array of materials' }, 403: { description: 'Not your course' } },
      },
      post: {
        tags: ['V2 — Admin'],
        summary: 'Upload a material or recording (multipart)',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['title', 'file'],
                properties: {
                  title:        { type: 'string', example: 'Week 1 — Setup & tooling' },
                  file:         { type: 'string', format: 'binary', description: 'Max 50MB' },
                  category:     { type: 'string', enum: ['MATERIAL', 'RECORDING'], default: 'MATERIAL' },
                  description:  { type: 'string' },
                  curriculumId: { type: 'string', description: 'Attach to a curriculum week' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created material' }, 403: { description: 'Not your course' } },
      },
    },
    '/v2/admin/materials/{id}': {
      delete: {
        tags: ['V2 — Admin'],
        summary: 'Delete a material and its Cloudinary asset',
        security: secured,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' }, 403: { description: 'Not your course' } },
      },
    },

  },
}

// V2-only view of the spec (new intake) — served at /v2/docs
export const v2SwaggerSpec = {
  ...swaggerSpec,
  info: {
    title: 'Web3Nova V2 API',
    version: '2.0.0',
    description:
      'Web3Nova V2 — new intake. Register with studentName + photo + course choice, ' +
      'login with studentName, then courses and course library (recordings & materials). ' +
      'Click **Authorize** and paste your JWT for the protected endpoints.',
  },
  tags: swaggerSpec.tags.filter(t => t.name.startsWith('V2')),
  paths: Object.fromEntries(
    Object.entries(swaggerSpec.paths).filter(([path]) => path.startsWith('/v2'))
  ),
}
