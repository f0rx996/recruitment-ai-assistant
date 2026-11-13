# Demo login (university project)

These are **fictional demo credentials** for running the project locally. Do not reuse them for anything real.

| | |
|---|---|
| HR login page | http://localhost:3000/hr/login |
| Email | `admin@uni-demo.test` |
| Password | `Recruit-Demo-2026` |
| Role | admin (can also delete applications) |

Public candidate site: http://localhost:3000

## Recreate everything

With the app running (`npm run dev`), run:

```bash
npm run seed:demo
```

This creates or resets the login above, the "Data Analyst" job, and 3 fictional applicants (Sara Khan, Ahmed Ali,
Mohammed Hassan). You can run it again safely: it skips anything that already exists.

## Things to try in the AI Assistant

- Compare all three candidates and recommend who we should interview first.
- Generate interview questions for the strongest candidate.
- Who has experience with Python, SQL, and Power BI?
- What requirements are missing from Ahmed's CV?
- Which applicants have cloud computing certifications?
