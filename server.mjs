import "dotenv/config";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = fileURLToPath(new URL(".", import.meta.url));
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured.");
}
const supabaseEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
if (supabaseEnabled && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be configured when Supabase is enabled.");
}
const supabase = supabaseEnabled
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null;
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
const sessions = new Map();
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

async function getSession(request) {
  const id = cookieValue(request, "lead_session");
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  if (session.role === "sales") {
    const account = await findSalesAccountById(session.salesId);
    if (!account?.isActive) {
      sessions.delete(id);
      return null;
    }
  }
  return { id, ...session };
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

function unwrap(result) {
  if (result.error) {
    throw new Error(`Supabase request failed: ${result.error.message}`);
  }
  return result.data;
}

function sendRouteError(response, error, fallbackMessage) {
  const isDatabaseError = error.message?.startsWith("Supabase request failed:");
  if (isDatabaseError) console.error(error);
  sendJson(response, isDatabaseError ? 503 : 400, {
    error: isDatabaseError ? error.message : error.message || fallbackMessage
  });
}

function accountFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    salt: row.password_salt,
    hash: row.password_hash,
    spreadsheetUrl: row.spreadsheet_url,
    isActive: row.is_active
  };
}

function leadFromRow(row) {
  return {
    id: row.id,
    nameUser: row.name_user,
    phone: row.phone,
    ownerId: row.owner_id,
    salesName: row.sales_name,
    domicile: row.domicile || "",
    source: row.source || "",
    leadCode: row.lead_code || "",
    createdAt: row.created_at,
    finalResult: row.final_result || "",
    followUps: row.follow_ups || []
  };
}

async function findSalesAccountByEmail(email) {
  if (!supabaseEnabled) return accounts.find((item) => item.email === email && item.isActive) || null;
  const row = unwrap(await supabase.from("sales_accounts").select("*").eq("email", email).eq("is_active", true).maybeSingle());
  return row ? accountFromRow(row) : null;
}

async function salesEmailExists(email) {
  if (!supabaseEnabled) return accounts.some((item) => item.email === email);
  const row = unwrap(await supabase.from("sales_accounts").select("id").eq("email", email).maybeSingle());
  return Boolean(row);
}

async function findSalesAccountById(id) {
  if (!supabaseEnabled) return accounts.find((item) => item.id === id) || null;
  const row = unwrap(await supabase.from("sales_accounts").select("*").eq("id", id).maybeSingle());
  return row ? accountFromRow(row) : null;
}

async function listSalesAccounts() {
  if (!supabaseEnabled) return accounts.map(publicAccount);
  const rows = unwrap(await supabase.from("sales_accounts").select("*").order("created_at", { ascending: true }));
  return rows.map((row) => publicAccount(accountFromRow(row)));
}

async function createSalesAccount(account) {
  if (!supabaseEnabled) {
    accounts.push(account);
    return account;
  }
  const row = unwrap(await supabase.from("sales_accounts").insert({
    id: account.id,
    name: account.name,
    email: account.email,
    password_salt: account.salt,
    password_hash: account.hash,
    spreadsheet_url: account.spreadsheetUrl,
    is_active: account.isActive
  }).select("*").single());
  return accountFromRow(row);
}

async function setSalesAccountActive(id, isActive) {
  if (!supabaseEnabled) {
    const account = accounts.find((item) => item.id === id);
    if (account) account.isActive = isActive;
    return account || null;
  }
  const row = unwrap(await supabase.from("sales_accounts").update({ is_active: isActive }).eq("id", id).select("*").maybeSingle());
  return row ? accountFromRow(row) : null;
}

async function listSalesLeads(ownerId) {
  if (!supabaseEnabled) return leads.filter((lead) => lead.ownerId === ownerId);
  const rows = unwrap(await supabase.from("leads").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }));
  return rows.map(leadFromRow);
}

async function createSalesLead(lead) {
  if (!supabaseEnabled) {
    leads.unshift(lead);
    return lead;
  }
  const row = unwrap(await supabase.from("leads").insert({
    id: lead.id,
    name_user: lead.nameUser,
    phone: lead.phone,
    owner_id: lead.ownerId,
    sales_name: lead.salesName,
    domicile: lead.domicile,
    source: lead.source,
    lead_code: lead.leadCode,
    created_at: lead.createdAt,
    final_result: lead.finalResult,
    follow_ups: lead.followUps
  }).select("*").single());
  return leadFromRow(row);
}

async function saveSalesLead(lead) {
  if (!supabaseEnabled) return lead;
  const row = unwrap(await supabase.from("leads").update({
    final_result: lead.finalResult,
    follow_ups: lead.followUps
  }).eq("id", lead.id).select("*").single());
  return leadFromRow(row);
}

function isGoogleSheetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.google.com" &&
      /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
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
    if (supabaseEnabled) {
      unwrap(await supabase.from("sales_accounts").select("id", { head: true, count: "exact" }));
    }
    sendJson(response, 200, {
      mode: supabaseEnabled ? "supabase" : "demo",
      connectedToDatabase: supabaseEnabled,
      connectedToSpreadsheet: false
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

      const sessionId = randomBytes(32).toString("base64url");
      sessions.set(sessionId, { ...session, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      sendJson(response, 200, { user }, {
        "Set-Cookie": `lead_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
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
    const sessionId = cookieValue(request, "lead_session");
    if (sessionId) sessions.delete(sessionId);
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": "lead_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
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
      const spreadsheetUrl = String(input.spreadsheetUrl || "").trim();
      if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(response, 400, { error: "Nama sales dan alamat email yang valid wajib diisi." });
        return;
      }
      if (!/^\d{6,12}$/.test(password)) {
        sendJson(response, 400, { error: "Password sales harus terdiri dari 6–12 angka." });
        return;
      }
      if (!isGoogleSheetUrl(spreadsheetUrl)) {
        sendJson(response, 400, { error: "Masukkan link Google Sheets yang valid." });
        return;
      }
      if (await salesEmailExists(email)) {
        sendJson(response, 409, { error: "Email sudah terdaftar." });
        return;
      }

      const account = {
        id: randomUUID(),
        name,
        email,
        ...passwordRecord(password),
        spreadsheetUrl,
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
      if (!input.isActive) {
        for (const [id, activeSession] of sessions) {
          if (activeSession.salesId === account.id) sessions.delete(id);
        }
      }

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
      if (!nameUser || !phone) {
        sendJson(response, 400, { error: "Nama user dan nomor HP wajib diisi." });
        return;
      }

      const account = await findSalesAccountById(session.salesId);
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
        followUps: [{ number: 1, result: "Lead masuk", createdAt }]
      };
      const savedLead = await createSalesLead(lead);
      sendJson(response, 201, { lead: savedLead });
    } catch (error) {
      sendRouteError(response, error, "Data lead tidak valid.");
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
      if (!Number.isInteger(number) || number < 2 || number > 8 || !result ||
        !isValidDate(followUpDate)) {
        sendJson(response, 400, { error: "Pilih FU 2–8, tanggal follow-up yang valid, dan isi hasilnya." });
        return;
      }

      const existing = lead.followUps.find((item) => item.number === number);
      const createdAt = new Date().toISOString();
      const late = todayLocal() > addDays(followUpDate, 1);
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
      sendJson(response, 200, { lead: await saveSalesLead(lead) });
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
