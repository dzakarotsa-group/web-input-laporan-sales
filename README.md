# Lead Desk

Lead Desk stores the sales account registry in a private Google Spreadsheet and stores each salesperson's leads and follow-up history in that salesperson's own Google Spreadsheet. The backend detects an existing lead table from its column headers and reads or appends to that table in place; it does not replace existing rows or create a duplicate `leads` tab. A new, empty sales spreadsheet gets a `leads` tab automatically. Login sessions use signed cookies so they work across Vercel Function instances.

## Connect Google Sheets

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Create a private account-registry spreadsheet. Set `GOOGLE_SHEETS_SPREADSHEET_ID` to its ID (the part between `/d/` and `/edit` in its URL).
3. Share the account-registry spreadsheet with the service account's `client_email` as **Editor**.
4. Copy `.env.example` to `.env`. Put the service-account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` as a Base64-encoded string. Keep this secret on the server only; never put it in `client.js`, a public environment variable, or source control.
5. Generate a random `SESSION_SECRET` of at least 32 bytes with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. This signs login cookies so sessions work across Vercel Function instances.
6. Set a private `ADMIN_EMAIL` and a 6–12 digit `ADMIN_PASSWORD`, then run `npm start`.
7. Open `/api/health`. A successful connection reports `"mode":"spreadsheet"` and `"connectedToSpreadsheet":true`.
8. Log in as admin and register each salesperson with their own spreadsheet URL. Share every sales spreadsheet with the service account as **Editor**. Do not share the private account-registry spreadsheet with sales staff.
9. Existing sales sheets are recognized by headers such as `Nama User`, `Nomor HP`, and `FU 1`–`FU 8`. Keep the current headers and data in place; the app reads previous rows and appends new leads there.

Sales can edit existing or newly added lead details. FU 1's date is entered when a lead is created; sales can then enter or update the date for FU 1–8 from the follow-up page. The app marks an entry late only when the current date in Jakarta is more than two days after the FU date (past H+2). Existing sheets keep their current columns and data.

The overview metric cards are clickable filters for this month's leads, leads needing follow-up, followed-up leads, and today's follow-ups. The overview shows only the five newest non-empty leads. A visit-priority list reads `Booking Visit?`, `Sudah Terlaksana?`, and `Tanggal Visit` from compatible existing sales sheets, showing booked visits that have not been marked completed.

For Vercel, import the GitHub repository and add these five variables (`GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`) as server-side environment variables for Production, then redeploy. Production refuses to start without Google Sheets and a strong session secret configured. The older `SUPABASE_*` variables are no longer used.

## Move existing Supabase data

The app does not delete or automatically copy data from the old Supabase project. If leads are already in each salesperson's spreadsheet, keep those sheets and only migrate their sales accounts so the existing `spreadsheet_url` links remain attached. The app will read and continue using those leads in place. If leads exist only in Supabase:

1. Create each salesperson's own Google Spreadsheet and share it with the service account.
2. Export the `sales_accounts` and `leads` tables from Supabase as CSV files, including column headers.
3. Import `sales_accounts` into the private account-registry spreadsheet's `sales_accounts` tab. Keep each row's existing `spreadsheet_url`, password salt/hash, and account ID unchanged.
4. For each salesperson, filter the exported `leads` CSV by `owner_id`, then import those rows into that salesperson's spreadsheet under a `leads` tab. Preserve the column order and the `follow_ups` JSON values.
5. Deploy with the spreadsheet variables above and verify each sales account sees their own previous leads and can save a follow-up before removing the old Supabase project.

The backend creates these headers automatically when the tabs are empty:

- `sales_accounts`: `id`, `name`, `email`, `password_salt`, `password_hash`, `spreadsheet_url`, `is_active`, `created_at`
- `leads`: `id`, `name_user`, `phone`, `owner_id`, `sales_name`, `domicile`, `source`, `lead_code`, `created_at`, `final_result`, `follow_ups`

## Local demo

With no Google Sheets variables set, `npm start` runs a local demo using temporary sample data. This mode is not persistent and must not be used for real or online data. Install Node.js 22 or newer and open `http://127.0.0.1:4173`.

The app hashes sales passwords before storing them. Google service-account credentials stay on the backend. Keep the account-registry spreadsheet private because it contains password hashes; each sales spreadsheet can be shared only with its owner and the service account. Login cookies are signed and expire after eight hours.
