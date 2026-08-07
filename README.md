# Compla Client OS

A complete, responsive client tracker for recurring payments, client status, next steps, marketing tasks, and follow-up activity.

## Seeded clients

The first time a workspace is opened with no client data, it automatically creates:

- **Kaiser Mobile Detailing** — $200/month — due on the 12th
- **The One Clear Choice Auto Glass** — due on the 14th — amount left editable
- **ZH Homes** — due on the 26th — amount left editable

The two missing payment amounts are intentionally left blank instead of being guessed.

## Included features

- Monthly payment tracker with Paid / Due soon / Overdue states
- Expected vs collected recurring revenue
- Client cards with **Currently** and **Next step** fields
- Client priority, status, notes, and last-touched tracking
- Kanban task board: Next up / In progress / Waiting / Done
- 10 one-click recurring marketing task presets
- Client Pulse that flags stale clients, urgent tasks, and payment problems
- Activity trail for client touchpoints
- Desktop sidebar + mobile bottom navigation
- Supabase email/password authentication
- Supabase Row Level Security so each user can access only their own rows
- Local browser-storage fallback when Supabase is not configured
- JSON data export
- No npm packages and no build step

## Common task presets

1. Google Ads optimization
2. Search terms & negative keywords
3. Conversion tracking
4. Landing page / website update
5. Lead form / automation
6. Lead quality / call review
7. Client follow-up / strategy check-in
8. Reporting / performance summary
9. Google Business Profile
10. Meta / Facebook Ads

# Fast setup

## 1. Create Supabase database

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste the complete contents of `supabase/schema.sql`.
4. Run it once.

That creates the four tables, indexes, foreign keys, authentication ownership fields, and Row Level Security policies.

## 2. Push this folder to GitHub

Upload all files and folders exactly as they are.

## 3. Import the GitHub repo into Vercel

No framework preset or build command is needed. This is a static site with one small Vercel function.

## 4. Add Vercel environment variables

In Vercel -> Project -> Settings -> Environment Variables, add:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

You can find both values in Supabase under the project's API settings.

Then redeploy the Vercel project.

The included `api/config.js` safely exposes those browser-appropriate Supabase values to the app at runtime. The anon key is not a secret; database security is enforced by Row Level Security.

## 5. Create your login

Open the deployed app and choose **Create an account**.

If Supabase email confirmation is enabled, confirm the email and then sign in. For a private personal dashboard, you can disable email confirmation in Supabase Authentication settings if you want instant account creation.

After the first successful login, the three default clients are automatically inserted if your account has no clients yet.

# Local testing

Because the app has no build step, you can serve it with any basic local web server.

Example with Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

For local Supabase testing, put your Supabase values into `config.js`. If you leave `config.js` blank, the app automatically runs in local-storage mode.

# File map

```text
compla-client-tracker/
├── index.html
├── styles.css
├── app.js
├── config.js
├── vercel.json
├── api/
│   └── config.js
└── supabase/
    └── schema.sql
```

# Security

Do not put a Supabase **service role key** anywhere in this project. Use only the public anon key. The SQL file enables Row Level Security and restricts each table to the authenticated row owner.
