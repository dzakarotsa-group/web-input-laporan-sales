import "dotenv/config";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHmac, createSign, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const accountsSpreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
const serviceAccountValue = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const deployedRuntime = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
if (Boolean(accountsSpreadsheetId) !== Boolean(serviceAccountValue)) {
  throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON must both be configured.");
}
const sheetsEnabled = Boolean(accountsSpreadsheetId && serviceAccountValue);
if (deployedRuntime && !sheetsEnabled) {
  throw new Error("Google Sheets must be configured before deploying this application.");
}
const sessionSecret = process.env.SESSION_SECRET || (deployedRuntime ? "" : "lead-desk-local-session-secret");
if (deployedRuntime && Buffer.byteLength(sessionSecret) < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 bytes before deploying.");
}
if (sheetsEnabled && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be configured when Google Sheets is enabled.");
}
const serviceAccountJson = sheetsEnabled
  ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || serviceAccountValue,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ? "base64" : "utf8").toString("utf8")
  : "";
const serviceAccount = sheetsEnabled ? JSON.parse(serviceAccountJson) : null;
if (sheetsEnabled && (!serviceAccount.client_email || !serviceAccount.private_key)) {
  throw new Error("Google service account JSON must include client_email and private_key.");
}
let sheetsAccessToken = "";
let sheetsAccessTokenExpiresAt = 0;
const sheetsReadyPromises = new Map();
const leadTableCache = new Map();
const sheetHeaders = {
  sales_accounts: ["id", "name", "email", "password_salt", "password_hash", "spreadsheet_url", "is_active", "created_at"],
  leads: ["id", "name_user", "phone", "owner_id", "sales_name", "domicile", "source", "lead_code", "created_at", "final_result", "follow_ups"]
};
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const sampleNow = Date.now();
const hoursAgo = (hours) => new Date(sampleNow - hours * 60 * 60 * 1000).toISOString();
const passwordRecord = (password) => {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: scryptSync(password, salt, 64).toString("hex") };
};
const accounts = [
  {
    id: "sales-demo-anisa",
    name: "Anisa",
    email: "anisa@demo.local",
    ...passwordRecord("123456"),
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/DEMO-SHEET-ANISA/edit",
    isActive: true
  }
];
const admin = {
  email: (process.env.ADMIN_EMAIL || "admin@demo.local").trim().toLowerCase(),
  ...passwordRecord(process.env.ADMIN_PASSWORD || "246810")
};
const leads = [
  {
    id: "lead-demo-1",
    nameUser: "Dina Puspita",
    phone: "0812•••••321",
    ownerId: "sales-demo-anisa",
    salesName: "Anisa",
    domicile: "Surabaya",
    source: "Instagram",
    leadCode: "LD-2401",
    createdAt: hoursAgo(24),
    finalResult: "Minta dikirimkan info paket.",
    followUps: [
      { number: 1, result: "Lead masuk", createdAt: hoursAgo(24) },
      { number: 2, result: "Minta dikirimkan info paket.", createdAt: hoursAgo(4) }
    ]
  },
  {
    id: "lead-demo-2",
    nameUser: "Rizky Maulana",
    phone: "0857•••••902",
    ownerId: "sales-demo-anisa",
    salesName: "Anisa",
    domicile: "Sidoarjo",
    source: "Referensi",
    leadCode: "LD-2402",
    createdAt: hoursAgo(48),
    finalResult: "",
    followUps: [{ number: 1, result: "Lead masuk", createdAt: hoursAgo(48) }]
  },
  {
    id: "lead-demo-3",
    nameUser: "Maya Putri",
    phone: "0813•••••517",
    ownerId: "sales-demo-anisa",
    salesName: "Anisa",
    domicile: "Gresik",
    source: "WhatsApp",
    leadCode: "LD-2403",
    createdAt: hoursAgo(72 + 1 / 60),
    finalResult: "",
    followUps: [{ number: 1, result: "Lead masuk", createdAt: hoursAgo(72 + 1 / 60) }]
  }
];

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function createSessionToken(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSessionToken(token) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", sessionSecret).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isFinite(session.expiresAt) || !["admin", "sales"].includes(session.role) ||
      (session.role === "sales" && typeof session.salesId !== "string")) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function getSession(request) {
  const session = readSessionToken(cookieValue(request, "lead_session"));
  if (!session) return null;
  if (session.expiresAt <= Date.now()) return null;
  if (session.role === "sales") {
    const account = await findSalesAccountById(session.salesId);
    if (!account?.isActive) return null;
  }
  return session;
}

function verifyPassword(password, record) {
  const candidate = scryptSync(password, Buffer.from(record.salt, "hex"), 64);
  return timingSafeEqual(candidate, Buffer.from(record.hash, "hex"));
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    spreadsheetUrl: account.spreadsheetUrl,
    isActive: account.isActive
  };
}

function sendRouteError(response, error, fallbackMessage) {
  const isStorageError = error.message?.startsWith("Google Sheets request failed:");
  if (isStorageError) console.error(error);
  sendJson(response, isStorageError ? 503 : 400, {
    error: isStorageError ? error.message : error.message || fallbackMessage
  });
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getSheetsAccessToken() {
  if (sheetsAccessToken && sheetsAccessTokenExpiresAt > Date.now() + 60_000) {
    return sheetsAccessToken;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(unsignedToken).sign(serviceAccount.private_key, "base64url");
  const assertion = `${unsignedToken}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Google Sheets request failed: ${data.error_description || data.error || "Autentikasi Google gagal."}`);
  }
  sheetsAccessToken = data.access_token;
  sheetsAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return sheetsAccessToken;
}

async function sheetsRequest(path, options = {}, targetSpreadsheetId = accountsSpreadsheetId) {
  try {
    const token = await getSheetsAccessToken();
    const suffix = path.startsWith(":") || path.startsWith("?") ? path : `/${path}`;
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetSpreadsheetId)}${suffix}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Google Sheets mengembalikan HTTP ${response.status}.`);
    }
    return data;
  } catch (error) {
    if (error.message?.startsWith("Google Sheets request failed:")) throw error;
    throw new Error(`Google Sheets request failed: ${error.message}`);
  }
}

async function ensureSheetsReady(targetSpreadsheetId = accountsSpreadsheetId, titles = ["sales_accounts"]) {
  if (!sheetsEnabled) return;
  const cacheKey = `${targetSpreadsheetId}:${titles.join(",")}`;
  if (!sheetsReadyPromises.has(cacheKey)) {
    const readyPromise = (async () => {
      const { sheets = [] } = await sheetsRequest("?fields=sheets.properties(sheetId,title)", {}, targetSpreadsheetId);
      const existing = new Set(sheets.map((sheet) => sheet.properties.title));
      const missing = titles.filter((title) => !existing.has(title));
      if (missing.length) {
        await sheetsRequest(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({
            requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
          })
        }, targetSpreadsheetId);
      }
      for (const title of titles) {
        const headers = sheetHeaders[title];
        const range = `${title}!A1:${String.fromCharCode(64 + headers.length)}1`;
        const { values = [] } = await sheetsRequest(`values/${encodeURIComponent(range)}`, {}, targetSpreadsheetId);
        if (!values.length) {
          await sheetsRequest(`values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
            method: "PUT",
            body: JSON.stringify({ values: [headers] })
          }, targetSpreadsheetId);
        }
      }
    })().catch((error) => {
      sheetsReadyPromises.delete(cacheKey);
      throw error;
    });
    sheetsReadyPromises.set(cacheKey, readyPromise);
  }
  await sheetsReadyPromises.get(cacheKey);
}

async function getSheetRows(title, targetSpreadsheetId = accountsSpreadsheetId) {
  await ensureSheetsReady(targetSpreadsheetId, [title]);
  const endColumn = String.fromCharCode(64 + sheetHeaders[title].length);
  const { values = [] } = await sheetsRequest(
    `values/${encodeURIComponent(`${quoteSheetTitle(title)}!A2:${endColumn}`)}`, {}, targetSpreadsheetId
  );
  return values;
}

function accountFromRow(row) {
  return {
    id: row[0],
    name: row[1],
    email: row[2],
    salt: row[3],
    hash: row[4],
    spreadsheetUrl: row[5],
    isActive: row[6] === "true",
    createdAt: row[7]
  };
}

function accountToRow(account) {
  return [account.id, account.name, account.email, account.salt, account.hash,
    account.spreadsheetUrl, String(account.isActive), account.createdAt || new Date().toISOString()];
}

function googleSpreadsheetId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    return url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || null;
  } catch {
    return null;
  }
}

function quoteSheetTitle(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function normalizeHeader(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

const leadHeaderAliases = {
  id: ["id", "leadid"],
  nameUser: ["namauser", "namalead", "namaleads", "nama", "nameuser", "leadname"],
  phone: ["nomorhp", "nohp", "nomorhandphone", "nomortelepon", "phone"],
  salesName: ["namasales", "sales", "salesname"],
  domicile: ["domisili", "kota", "domicile"],
  source: ["sumberlead", "sumberleads", "sumber", "source"],
  leadCode: ["kodelead", "kodeleads", "leadcode"],
  visitBooked: ["bookingvisit", "bookedvisit", "visitbooked"],
  visitCompleted: ["sudahterlaksana", "visitdone", "visitcompleted"],
  visitDate: ["tanggalvisit", "visitdate", "jadwalvisit"],
  createdAt: ["tanggal", "tanggallead", "tanggalmasuk", "createdat", "date", "column1"],
  finalResult: ["hasilakhir", "hasilfollowup", "hasilfu", "finalresult"],
  previousResult: ["hasilsebelumnya", "hasilsebelum", "previousresult"],
  followUpsJson: ["followups", "riwayatfollowup", "followupsjson"],
  ownerId: ["ownerid", "salesid"]
};

function leadSchemaForHeaders(headers) {
  const normalized = headers.map(normalizeHeader);
  const columns = {};
  for (const [field, aliases] of Object.entries(leadHeaderAliases)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) columns[field] = index;
  }
  columns.followUpDates = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return normalized.findIndex((header) => [
      `fu${number}`, `followup${number}`, `followup${number}date`, `tanggalfu${number}`
    ].includes(header));
  });
  columns.followUpResults = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return normalized.findIndex((header) => [
      `fu${number}hasil`, `hasilfu${number}`, `fu${number}result`
    ].includes(header));
  });
  if (columns.nameUser === undefined || columns.phone === undefined) return null;
  return { headers, columns };
}

async function findLeadTable(targetSpreadsheetId) {
  if (leadTableCache.has(targetSpreadsheetId)) return leadTableCache.get(targetSpreadsheetId);
  const discovery = (async () => {
    const { sheets = [] } = await sheetsRequest(
      "?fields=sheets.properties(sheetId,title)", {}, targetSpreadsheetId
    );
    let hasExistingData = false;
    for (const sheet of sheets) {
      const title = sheet.properties.title;
      const range = `${quoteSheetTitle(title)}!A1:AZ10`;
      const { values = [] } = await sheetsRequest(
        `values/${encodeURIComponent(range)}`, {}, targetSpreadsheetId
      );
      if (values.some((row) => row.some((value) => String(value).trim()))) hasExistingData = true;
      for (let index = 0; index < values.length; index += 1) {
        const schema = leadSchemaForHeaders(values[index]);
        if (schema) {
          if (schema.columns.followUpsJson === undefined && schema.columns.followUpDates[0] < 0) {
            throw new Error("Google Sheets request failed: Spreadsheet sales harus memiliki kolom FU 1 atau Follow-ups.");
          }
          return { title, headerRow: index + 1, ...schema };
        }
      }
    }

    if (hasExistingData) {
      throw new Error("Google Sheets request failed: Header spreadsheet sales tidak dikenali. Pastikan ada kolom Nama User dan Nomor HP.");
    }
    await ensureSheetsReady(targetSpreadsheetId, ["leads"]);
    return { title: "leads", headerRow: 1, ...leadSchemaForHeaders(sheetHeaders.leads) };
  })().catch((error) => {
    leadTableCache.delete(targetSpreadsheetId);
    throw error;
  });
  leadTableCache.set(targetSpreadsheetId, discovery);
  return discovery;
}

function spreadsheetDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86400_000)).toISOString().slice(0, 10);
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const localDate = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (localDate) {
    const [, day, month, year] = localDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function spreadsheetFlag(value) {
  const text = String(value || "").trim();
  return ["✓", "✔", "☑"].includes(text) ||
    ["true", "1", "yes", "ya", "mau", "booking", "booked", "sudah", "terlaksana", "selesai", "done", "completed"]
      .includes(normalizeHeader(text));
}

function spreadsheetDateValue(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400_000 + 25569;
}

function spreadsheetLeadId(row, rowNumber, columns) {
  const get = (column) => column === undefined ? "" : row[column] ?? "";
  if (get(columns.id)) return String(get(columns.id));
  const leadCode = String(get(columns.leadCode)).trim();
  return leadCode ? `code:${leadCode}:${get(columns.phone)}` : `row:${rowNumber}`;
}

function leadFromSpreadsheetRow(row, rowNumber, schema, ownerId, salesName) {
  const get = (column) => column === undefined ? "" : row[column] ?? "";
  const createdDate = spreadsheetDate(get(schema.columns.createdAt));
  const finalResult = String(get(schema.columns.finalResult));
  let followUps;
  if (schema.columns.followUpsJson !== undefined && get(schema.columns.followUpsJson)) {
    try {
      followUps = JSON.parse(get(schema.columns.followUpsJson));
    } catch (error) {
      throw new Error(`Riwayat follow-up pada baris ${rowNumber} tidak valid: ${error.message}`);
    }
  } else {
    const populatedFollowUps = schema.columns.followUpDates
      .map((column, index) => column >= 0 && row[column] ? index + 1 : null)
      .filter((number) => number !== null);
    const latestNumber = populatedFollowUps[populatedFollowUps.length - 1];
    const previousNumber = populatedFollowUps[populatedFollowUps.length - 2];
    const previousResult = String(get(schema.columns.previousResult));
    followUps = schema.columns.followUpDates.map((column, index) => {
      if (column < 0 || !row[column]) return null;
      const number = index + 1;
      const followUpDate = spreadsheetDate(row[column]);
      const resultColumn = schema.columns.followUpResults[index];
      const result = resultColumn >= 0 && row[resultColumn]
        ? String(row[resultColumn])
        : number === latestNumber
          ? finalResult || (number === 1 ? "Lead masuk" : `FU ${number} tercatat`)
          : number === previousNumber && previousResult
            ? previousResult
            : number === 1 ? "Lead masuk" : `FU ${number} tercatat`;
      return {
        number,
        result,
        createdAt: followUpDate ? `${followUpDate}T00:00:00.000Z` : new Date().toISOString(),
        ...(followUpDate ? { followUpDate } : {})
      };
    }).filter(Boolean);
    if (!followUps.length) {
      const date = createdDate || new Date().toISOString().slice(0, 10);
      followUps = [{ number: 1, result: "Lead masuk", createdAt: `${date}T00:00:00.000Z` }];
    }
  }
  return {
    id: spreadsheetLeadId(row, rowNumber, schema.columns),
    nameUser: String(get(schema.columns.nameUser)),
    phone: String(get(schema.columns.phone)),
    ownerId,
    salesName: String(get(schema.columns.salesName) || salesName),
    domicile: String(get(schema.columns.domicile)),
    source: String(get(schema.columns.source)),
    leadCode: String(get(schema.columns.leadCode)),
    visitBooked: spreadsheetFlag(get(schema.columns.visitBooked)) || Boolean(spreadsheetDate(get(schema.columns.visitDate))),
    visitCompleted: spreadsheetFlag(get(schema.columns.visitCompleted)),
    visitDate: spreadsheetDate(get(schema.columns.visitDate)),
    createdAt: createdDate ? `${createdDate}T00:00:00.000Z` : new Date().toISOString(),
    finalResult,
    followUps
  };
}

async function appendSheetRow(title, row, targetSpreadsheetId = accountsSpreadsheetId) {
  if (sheetHeaders[title]) await ensureSheetsReady(targetSpreadsheetId, [title]);
  return sheetsRequest(`values/${encodeURIComponent(`${quoteSheetTitle(title)}!A:${columnName(row.length - 1)}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row] })
  }, targetSpreadsheetId);
}

async function updateSheetRow(title, rowNumber, row, targetSpreadsheetId = accountsSpreadsheetId) {
  if (sheetHeaders[title]) await ensureSheetsReady(targetSpreadsheetId, [title]);
  const endColumn = columnName(row.length - 1);
  await sheetsRequest(`values/${encodeURIComponent(`${quoteSheetTitle(title)}!A${rowNumber}:${endColumn}${rowNumber}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [row] })
  }, targetSpreadsheetId);
}

async function findSalesAccountByEmail(email) {
  if (!sheetsEnabled) return accounts.find((item) => item.email === email && item.isActive) || null;
  const row = (await getSheetRows("sales_accounts")).find((item) => item[2] === email && item[6] === "true");
  return row ? accountFromRow(row) : null;
}

async function salesEmailExists(email) {
  if (!sheetsEnabled) return accounts.some((item) => item.email === email);
  return (await getSheetRows("sales_accounts")).some((row) => row[2] === email);
}

async function salesSpreadsheetExists(targetSpreadsheetId) {
  const salesAccounts = sheetsEnabled
    ? (await getSheetRows("sales_accounts")).map(accountFromRow)
    : accounts;
  return salesAccounts.some((account) => googleSpreadsheetId(account.spreadsheetUrl) === targetSpreadsheetId);
}

async function findSalesAccountById(id) {
  if (!sheetsEnabled) return accounts.find((item) => item.id === id) || null;
  const row = (await getSheetRows("sales_accounts")).find((item) => item[0] === id);
  return row ? accountFromRow(row) : null;
}

async function listSalesAccounts() {
  if (!sheetsEnabled) return accounts.map(publicAccount);
  return (await getSheetRows("sales_accounts")).map((row) => publicAccount(accountFromRow(row)));
}

async function createSalesAccount(account) {
  if (!sheetsEnabled) {
    accounts.push(account);
    return account;
  }
  await appendSheetRow("sales_accounts", accountToRow(account));
  return account;
}

async function setSalesAccountActive(id, isActive) {
  if (!sheetsEnabled) {
    const account = accounts.find((item) => item.id === id);
    if (account) account.isActive = isActive;
    return account || null;
  }
  const rows = await getSheetRows("sales_accounts");
  const index = rows.findIndex((row) => row[0] === id);
  if (index < 0) return null;
  const account = accountFromRow(rows[index]);
  account.isActive = isActive;
  await updateSheetRow("sales_accounts", index + 2, accountToRow(account));
  return account;
}

async function listSalesLeads(ownerId) {
  if (!sheetsEnabled) return leads.filter((lead) => lead.ownerId === ownerId);
  const account = await findSalesAccountById(ownerId);
  if (!account) return [];
  const ownerSpreadsheetId = googleSpreadsheetId(account.spreadsheetUrl);
  const table = await findLeadTable(ownerSpreadsheetId);
  const range = `${quoteSheetTitle(table.title)}!A${table.headerRow + 1}:AZ`;
  const { values = [] } = await sheetsRequest(`values/${encodeURIComponent(range)}`, {}, ownerSpreadsheetId);
  return values.map((row, index) => leadFromSpreadsheetRow(
    row, table.headerRow + index + 1, table, ownerId, account.name
  )).filter((lead) => lead.nameUser.trim() || lead.phone.trim())
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function createSalesLead(lead) {
  if (!sheetsEnabled) {
    leads.unshift(lead);
    return lead;
  }
  const account = await findSalesAccountById(lead.ownerId);
  if (!account) throw new Error("Akun sales tidak ditemukan.");
  const targetSpreadsheetId = googleSpreadsheetId(account.spreadsheetUrl);
  const table = await findLeadTable(targetSpreadsheetId);
  const row = Array(table.headers.length).fill("");
  const set = (field, value) => {
    const column = table.columns[field];
    if (column !== undefined) row[column] = value;
  };
  const firstFollowUpDate = lead.followUps.find((item) => item.number === 1)?.followUpDate || todayLocal();
  if (table.columns.id !== undefined) lead.id = randomUUID();
  set("id", lead.id);
  set("nameUser", lead.nameUser);
  set("phone", lead.phone);
  set("salesName", lead.salesName);
  set("domicile", lead.domicile);
  set("source", lead.source);
  set("leadCode", lead.leadCode);
  set("createdAt", spreadsheetDateValue(todayLocal()));
  set("ownerId", lead.ownerId);
  set("finalResult", lead.finalResult);
  if (table.columns.followUpsJson !== undefined) set("followUpsJson", JSON.stringify(lead.followUps));
  else if (table.columns.followUpDates[0] >= 0) {
    row[table.columns.followUpDates[0]] = spreadsheetDateValue(firstFollowUpDate);
  }
  const response = await appendSheetRow(table.title, row, targetSpreadsheetId);
  if (table.columns.id === undefined) {
    const appendedRow = response.updates?.updatedRange?.match(/!A(\d+)/)?.[1];
    if (!appendedRow) {
      throw new Error("Google Sheets request failed: Nomor baris lead baru tidak dikembalikan.");
    }
    lead.id = spreadsheetLeadId(row, Number(appendedRow), table.columns);
  }
  return lead;
}

async function saveSalesLead(lead, followUpNumber) {
  if (!sheetsEnabled) return lead;
  const account = await findSalesAccountById(lead.ownerId);
  if (!account) throw new Error("Akun sales tidak ditemukan.");
  const targetSpreadsheetId = googleSpreadsheetId(account.spreadsheetUrl);
  const table = await findLeadTable(targetSpreadsheetId);
  const range = `${quoteSheetTitle(table.title)}!A${table.headerRow + 1}:AZ`;
  const { values = [] } = await sheetsRequest(`values/${encodeURIComponent(range)}`, {}, targetSpreadsheetId);
  const index = values.findIndex((row, rowIndex) =>
    spreadsheetLeadId(row, table.headerRow + rowIndex + 1, table.columns) === lead.id
  );
  if (index < 0) throw new Error("Lead tidak ditemukan di spreadsheet.");
  const rowNumber = table.headerRow + index + 1;
  const updates = [];
  const addUpdate = (column, value) => {
    if (column !== undefined && column >= 0) {
      updates.push({
        range: `${quoteSheetTitle(table.title)}!${columnName(column)}${rowNumber}`,
        values: [[value]]
      });
    }
  };
  addUpdate(table.columns.finalResult, lead.finalResult);
  if (followUpNumber === null) {
    for (const field of ["nameUser", "phone", "domicile", "source", "leadCode"]) {
      addUpdate(table.columns[field], lead[field]);
    }
    if (table.columns.id === undefined) {
      const updatedRow = [...values[index]];
      for (const field of ["nameUser", "phone", "domicile", "source", "leadCode"]) {
        const column = table.columns[field];
        if (column !== undefined) updatedRow[column] = lead[field];
      }
      lead.id = spreadsheetLeadId(updatedRow, rowNumber, table.columns);
    }
  } else if (table.columns.followUpsJson !== undefined) {
    addUpdate(table.columns.followUpsJson, JSON.stringify(lead.followUps));
  } else {
    const followUp = lead.followUps.find((item) => item.number === followUpNumber);
    const followUpColumn = table.columns.followUpDates[followUp.number - 1];
    if (followUpColumn < 0) {
      throw new Error("Kolom follow-up tersebut tidak ditemukan di spreadsheet sales.");
    }
    addUpdate(followUpColumn, spreadsheetDateValue(followUp.followUpDate));
    const previousResult = table.columns.finalResult === undefined
      ? ""
      : String(values[index][table.columns.finalResult] || "");
    if (previousResult) addUpdate(table.columns.previousResult, previousResult);
    const resultColumn = table.columns.followUpResults[followUp.number - 1];
    addUpdate(resultColumn, followUp.result);
  }
  if (updates.length) {
    await sheetsRequest("values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: updates })
    }, targetSpreadsheetId);
  }
  return lead;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) {
      throw new Error("Request body is too large.");
    }
  }
  return JSON.parse(body);
}

export async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  try {

  if (url.pathname === "/api/health" && request.method === "GET") {
    if (sheetsEnabled) await ensureSheetsReady();
    sendJson(response, 200, {
      mode: sheetsEnabled ? "spreadsheet" : "demo",
      connectedToDatabase: sheetsEnabled,
      connectedToSpreadsheet: sheetsEnabled
    });
    return;
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    try {
      const input = await readJson(request);
      const email = String(input.email || "").trim().toLowerCase();
      const password = String(input.password || "");
      const role = String(input.role || "");
      if (password.length > 128) {
        sendJson(response, 400, { error: "Password terlalu panjang." });
        return;
      }
      let session;
      let user;

      if (role === "admin" && email === admin.email && verifyPassword(password, admin)) {
        session = { role: "admin" };
        user = { role: "admin", name: "Admin" };
      } else if (role === "sales") {
        const account = await findSalesAccountByEmail(email);
        if (account && verifyPassword(password, account)) {
          session = { role: "sales", salesId: account.id };
          user = { role: "sales", name: account.name, email: account.email };
        }
      }

      if (!session) {
        sendJson(response, 401, { error: "Email, password, atau jenis akun tidak sesuai." });
        return;
      }

      const sessionToken = createSessionToken({ ...session, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      const secureCookie = deployedRuntime ? "; Secure" : "";
      sendJson(response, 200, { user }, {
        "Set-Cookie": `lead_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`
      });
    } catch (error) {
      sendRouteError(response, error, "Permintaan login tidak valid.");
    }
    return;
  }

  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const session = await getSession(request);
    if (!session) {
      sendJson(response, 401, { error: "Sesi sudah berakhir. Silakan login kembali." });
      return;
    }
    if (session.role === "admin") {
      sendJson(response, 200, { user: { role: "admin", name: "Admin" } });
      return;
    }
    const account = await findSalesAccountById(session.salesId);
    sendJson(response, 200, { user: { role: "sales", name: account.name, email: account.email } });
    return;
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const secureCookie = deployedRuntime ? "; Secure" : "";
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `lead_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`
    });
    return;
  }

  const session = await getSession(request);
  if (url.pathname.startsWith("/api/") && !session) {
    sendJson(response, 401, { error: "Silakan login kembali." });
    return;
  }

  if (url.pathname.startsWith("/api/admin/") && session?.role !== "admin") {
    sendJson(response, 403, { error: "Akses hanya untuk admin." });
    return;
  }

  if (url.pathname === "/api/admin/sales" && request.method === "GET") {
    sendJson(response, 200, { sales: await listSalesAccounts() });
    return;
  }

  if (url.pathname === "/api/admin/sales" && request.method === "POST") {
    try {
      const input = await readJson(request);
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const password = String(input.password || "");
      const salesSpreadsheetUrl = String(input.spreadsheetUrl || "").trim();
      if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(response, 400, { error: "Nama sales dan alamat email yang valid wajib diisi." });
        return;
      }
      if (!/^\d{6,12}$/.test(password)) {
        sendJson(response, 400, { error: "Password sales harus terdiri dari 6–12 angka." });
        return;
      }
      const salesSpreadsheetId = googleSpreadsheetId(salesSpreadsheetUrl);
      if (!salesSpreadsheetId) {
        sendJson(response, 400, { error: "Masukkan link Google Sheets milik sales yang valid." });
        return;
      }
      if (await salesEmailExists(email)) {
        sendJson(response, 409, { error: "Email sudah terdaftar." });
        return;
      }
      if (await salesSpreadsheetExists(salesSpreadsheetId)) {
        sendJson(response, 409, { error: "Spreadsheet ini sudah terhubung ke akun sales lain." });
        return;
      }
      if (sheetsEnabled) await findLeadTable(salesSpreadsheetId);

      const account = {
        id: randomUUID(),
        name,
        email,
        ...passwordRecord(password),
        spreadsheetUrl: salesSpreadsheetUrl,
        isActive: true
      };
      const createdAccount = await createSalesAccount(account);
      sendJson(response, 201, { sales: publicAccount(createdAccount) });
    } catch (error) {
      sendRouteError(response, error, "Data sales tidak valid.");
    }
    return;
  }

  const adminSalesMatch = url.pathname.match(/^\/api\/admin\/sales\/([^/]+)$/);
  if (adminSalesMatch && request.method === "PATCH") {
    try {
      const account = await findSalesAccountById(decodeURIComponent(adminSalesMatch[1]));
      if (!account) {
        sendJson(response, 404, { error: "Akun sales tidak ditemukan." });
        return;
      }
      const input = await readJson(request);
      if (typeof input.isActive !== "boolean") {
        sendJson(response, 400, { error: "Status aktif akun tidak valid." });
        return;
      }
      const updatedAccount = await setSalesAccountActive(account.id, input.isActive);
      sendJson(response, 200, { sales: publicAccount(updatedAccount) });
    } catch (error) {
      sendRouteError(response, error, "Status sales tidak dapat diperbarui.");
    }
    return;
  }

  if (url.pathname === "/api/leads" && request.method === "GET") {
    if (session.role !== "sales") {
      sendJson(response, 403, { error: "Akses data lead hanya untuk sales." });
      return;
    }
    sendJson(response, 200, { leads: await listSalesLeads(session.salesId) });
    return;
  }

  if (url.pathname === "/api/leads" && request.method === "POST") {
    if (session.role !== "sales") {
      sendJson(response, 403, { error: "Akses data lead hanya untuk sales." });
      return;
    }
    try {
      const input = await readJson(request);
      const nameUser = String(input.nameUser || "").trim();
      const phone = String(input.phone || "").trim();
      const followUpDate = String(input.followUpDate || "");
      if (!nameUser || nameUser.length > 100 || !phone || phone.length > 30 ||
        !isValidDate(followUpDate)) {
        sendJson(response, 400, { error: "Nama user, nomor HP, dan tanggal FU 1 yang valid wajib diisi." });
        return;
      }

      const account = await findSalesAccountById(session.salesId);
      if (!account) {
        sendJson(response, 404, { error: "Akun sales tidak ditemukan." });
        return;
      }
      const createdAt = new Date().toISOString();
      const lead = {
        id: randomUUID(),
        nameUser,
        phone,
        ownerId: account.id,
        salesName: account.name,
        domicile: String(input.domicile || "").trim(),
        source: String(input.source || "").trim(),
        leadCode: String(input.leadCode || "").trim(),
        createdAt,
        finalResult: "",
        followUps: [{
          number: 1,
          result: "Lead masuk",
          createdAt,
          followUpDate,
          late: todayLocal() > addDays(followUpDate, 2)
        }]
      };
      const savedLead = await createSalesLead(lead);
      sendJson(response, 201, { lead: savedLead });
    } catch (error) {
      sendRouteError(response, error, "Data lead tidak valid.");
    }
    return;
  }

  const leadEditMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
  if (leadEditMatch && request.method === "PATCH") {
    if (session.role !== "sales") {
      sendJson(response, 403, { error: "Akses data lead hanya untuk sales." });
      return;
    }
    try {
      const input = await readJson(request);
      const lead = (await listSalesLeads(session.salesId))
        .find((item) => item.id === decodeURIComponent(leadEditMatch[1]));
      if (!lead) {
        sendJson(response, 404, { error: "Lead tidak ditemukan." });
        return;
      }
      const updates = {
        nameUser: String(input.nameUser || "").trim(),
        phone: String(input.phone || "").trim(),
        domicile: String(input.domicile || "").trim(),
        source: String(input.source || "").trim(),
        leadCode: String(input.leadCode || "").trim()
      };
      if (!updates.nameUser || updates.nameUser.length > 100 || !updates.phone || updates.phone.length > 30 ||
        updates.domicile.length > 100 || updates.source.length > 100 || updates.leadCode.length > 50) {
        sendJson(response, 400, { error: "Periksa kembali nama, nomor HP, domisili, sumber, dan kode lead." });
        return;
      }
      Object.assign(lead, updates);
      sendJson(response, 200, { lead: await saveSalesLead(lead, null) });
    } catch (error) {
      sendRouteError(response, error, "Data lead tidak dapat diperbarui.");
    }
    return;
  }

  const followUpMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups$/);
  if (followUpMatch && request.method === "POST") {
    if (session.role !== "sales") {
      sendJson(response, 403, { error: "Akses data lead hanya untuk sales." });
      return;
    }
    try {
      const input = await readJson(request);
      const number = Number(input.number);
      const result = String(input.result || "").trim();
      const followUpDate = String(input.followUpDate || "");
      const lead = (await listSalesLeads(session.salesId)).find((item) => item.id === decodeURIComponent(followUpMatch[1]));
      if (!lead) {
        sendJson(response, 404, { error: "Lead tidak ditemukan." });
        return;
      }
      if (!Number.isInteger(number) || number < 1 || number > 8 || !result ||
        !isValidDate(followUpDate)) {
        sendJson(response, 400, { error: "Pilih FU 1–8, tanggal follow-up yang valid, dan isi hasilnya." });
        return;
      }

      const existing = lead.followUps.find((item) => item.number === number);
      const createdAt = new Date().toISOString();
      const late = todayLocal() > addDays(followUpDate, 2);
      lead.finalResult = result;
      if (existing) {
        existing.result = result;
        existing.createdAt = createdAt;
        existing.followUpDate = followUpDate;
        existing.late = late;
      } else {
        lead.followUps.push({ number, result, createdAt, followUpDate, late });
        lead.followUps.sort((left, right) => left.number - right.number);
      }
      sendJson(response, 200, { lead: await saveSalesLead(lead, number) });
    } catch (error) {
      sendRouteError(response, error, "Data follow-up tidak valid.");
    }
    return;
  }

  const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!["index.html", "styles.css", "client.js"].includes(asset)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const filePath = join(root, asset);
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Terjadi kesalahan server. Silakan coba lagi." });
    } else {
      response.end();
    }
  }
}

export default handleRequest;
