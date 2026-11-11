# Lead Desk Web Preview

Responsive web preview for adding leads and recording follow-up notes. A new lead is automatically logged as FU 1 when it is added. A reminder appears only when more than 3 days have passed since its latest recorded FU; FU 2–8 are used for subsequent manual follow-ups. Sales choose the date the FU happened; an entry is marked late after H+1 has passed.

The preview includes a session login, a demo admin panel for adding/deactivating sales accounts and recording each sales spreadsheet link, and sales login with a numeric password. Demo credentials:

- Admin: `admin@demo.local` / `246810`
- Sales: `anisa@demo.local` / `123456`

Demo account passwords are salted and hashed. In demo mode, sales accounts and lead data are temporary and reset when the server restarts. The spreadsheet URL is saved as demo metadata only; this project does not authenticate with Google or write to a spreadsheet.

## Use Supabase Free for persistent data

The server can persist sales accounts and leads in a Supabase Postgres project while keeping the Supabase service-role key on the server:

1. Create a Supabase Free project.
2. In **SQL Editor**, run [`supabase-schema.sql`](./supabase-schema.sql).
3. Copy `.env.example` to `.env`. Fill in `SUPABASE_URL`, the server-only `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Restart with `npm start`. The login hint will indicate that admin credentials are configured by the server.

Keep the Supabase service-role key private; never add it to frontend JavaScript, GitHub, or a public deployment variable. Use it only as a secret environment variable on the Node.js backend. The database tables have RLS enabled and no client-access policies; only the backend service-role client should access them. Sales passwords are stored as salted scrypt hashes.

When both Supabase variables are configured, demo seed sales/leads are not used; create sales accounts after logging in as the configured admin. When Supabase is not configured, the existing in-memory demo mode remains available.

The app's current login sessions remain in memory and will need to log in again after a backend restart. The free Supabase plan can pause projects after inactivity and has plan-specific limits. Google Sheets writing is still not implemented; this setup only persists app data and spreadsheet links.

## Run locally

1. Install Node.js 22 or newer.
2. From this folder, run `npm start`.
3. Open `http://127.0.0.1:4173` and choose the **Sales** or **Admin** role.

The preview API is bound to `127.0.0.1` and uses an in-memory session/account store, not production-grade persistence or deployment security. Do not deploy it publicly or enter real customer information.

## Spreadsheet integration

The supplied CSV has 26 columns, including duplicate placeholder headers (`Column 1` appears twice) and 2,089 exported rows, many of which have no lead name. The preview uses only the lead fields and follow-up notes; it does not import these rows.

Before connecting real spreadsheets, the header row needs a clean, unique schema, each sheet must grant edit access through an authorized Google account/service, and the backend needs durable storage and a production authentication setup. Never put passwords, service-account keys, or OAuth client secrets in frontend files.
