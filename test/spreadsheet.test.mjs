import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

test("existing sales sheet data is continued in place and kept separate per salesperson", async () => {
  const dateInJakarta = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const dateOffset = (days) => {
    const date = new Date(`${dateInJakarta()}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const sheetDateSerial = (date) => Date.parse(`${date}T00:00:00.000Z`) / 86400_000 + 25569;
  const lateDate = dateOffset(-3);
  const hPlusTwoDate = dateOffset(-2);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "test-spreadsheet";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ format: "pem", type: "pkcs8" })
  });
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "123456";

  const workbooks = new Map();
  const legacyHeaders = [
    "Column 1", "Nama Sales", "Nama User", "Nomor HP", "Domisili", "Sumber Leads", "Kode Leads",
    "FU 1", "FU 2", "FU 3", "FU 4", "FU 5", "FU 6", "FU 7", "FU 8",
    "Rencana Visit", "Visit Terlaksana", "Kode Leads Visit", "Closing", "Kode Leads Closing",
    "Hasil Akhir", "Hasil Sebelumnya", "Indikator", "Column 1", "Column 2", "Tanggal Closing"
  ];
  const previousLead = Array(legacyHeaders.length).fill("");
  previousLead[0] = "01/06/2026";
  previousLead[1] = "Siti";
  previousLead[2] = "Lead Sebelumnya";
  previousLead[3] = "081234000111";
  previousLead[4] = "Surabaya";
  previousLead[5] = "Instagram";
  previousLead[6] = "LD-LAMA";
  previousLead[7] = "01/06/2026";
  previousLead[8] = "02/06/2026";
  previousLead[15] = "TRUE";
  previousLead[17] = "LD-VISIT-LAMA";
  previousLead[20] = "Pernah dihubungi";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(new URLSearchParams(init.body).get("grant_type"),
        "urn:ietf:params:oauth:grant-type:jwt-bearer");
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }

    assert.equal(url.hostname, "sheets.googleapis.com");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    const workbookMatch = url.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate)?$/);
    if (workbookMatch) {
      const workbookId = workbookMatch[1];
      if (!workbooks.has(workbookId)) {
        const workbook = new Map();
        if (workbookId === "siti-sheet-id") workbook.set("Input Harian", [legacyHeaders, previousLead]);
        workbooks.set(workbookId, workbook);
      }
      const workbook = workbooks.get(workbookId);
      if (url.pathname.endsWith(":batchUpdate")) {
        for (const request of JSON.parse(init.body).requests) {
          workbook.set(request.addSheet.properties.title, []);
        }
        return Response.json({});
      }
      return Response.json({
        sheets: [...workbook.keys()].map((title, index) => ({ properties: { title, sheetId: index } }))
      });
    }

    const valuesMatch = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
    if (url.pathname.endsWith("/values:batchUpdate")) {
      const workbookId = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)/)[1];
      const workbook = workbooks.get(workbookId);
      const updates = JSON.parse(init.body).data;
      for (const update of updates) {
        const match = update.range.match(/^'?(.*?)'?!([A-Z]+)(\d+)$/);
        const title = match[1];
        const column = [...match[2]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        const rowNumber = Number(match[3]);
        const rows = workbook.get(title);
        while (rows.length < rowNumber) rows.push([]);
        while (rows[rowNumber - 1].length <= column) rows[rowNumber - 1].push("");
        rows[rowNumber - 1][column] = update.values[0][0];
      }
      return Response.json({ totalUpdatedCells: updates.length });
    }
    assert.ok(valuesMatch, url.pathname);
    const workbook = workbooks.get(valuesMatch[1]);
    const range = decodeURIComponent(valuesMatch[2]);
    const [encodedTitle, cells] = range.split("!");
    const title = encodedTitle.replace(/^'|'$/g, "").replace(/''/g, "'");
    const rows = workbook?.get(title);
    assert.ok(rows, `missing mock sheet: ${title}`);
    const firstRow = Number(cells.match(/\d+/)?.[0] || 1);
    if (!init.method || init.method === "GET") {
      return Response.json({
        values: cells.includes("AZ10") ? rows.slice(0, 10) : rows.slice(firstRow - 1)
      });
    }

    const body = JSON.parse(init.body);
    if (url.pathname.includes(":append")) {
      const title = range.split("!")[0].replace(/^'|'$/g, "").replace(/''/g, "'");
      const rowNumber = rows.length + 1;
      rows.push(...body.values);
      return Response.json({ updates: { updatedRange: `${title}!A${rowNumber}:Z${rowNumber}` } });
    } else if (/^[A-Z]+\d+$/.test(cells)) {
      const cell = cells.match(/^([A-Z]+)(\d+)$/);
      const column = [...cell[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const rowNumber = Number(cell[2]);
      while (rows.length < rowNumber) rows.push([]);
      while (rows[rowNumber - 1].length <= column) rows[rowNumber - 1].push("");
      rows[rowNumber - 1][column] = body.values[0][0];
    } else {
      rows[firstRow - 1] = body.values[0];
    }
    return Response.json({ updatedRows: body.values.length });
  };

  const start = async (handler) => {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };
  const request = async (base, path, { method = "GET", body, cookie } = {}) => {
    const response = await realFetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { response, data: await response.json() };
  };
  const login = async (base, role, email, password) => {
    const result = await request(base, "/api/auth/login", {
      method: "POST",
      body: { role, email, password }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.response.headers.get("set-cookie").split(";")[0];
  };

  let app;
  try {
    const first = await import("../server.mjs?spreadsheet-test=first");
    app = await start(first.handleRequest);
    let result = await request(app.base, "/api/health");
    assert.equal(result.data.mode, "spreadsheet");
    assert.equal(result.data.connectedToSpreadsheet, true);

    const adminCookie = await login(app.base, "admin", "admin@example.com", "123456");
    result = await request(app.base, "/api/admin/sales", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Siti",
        email: "siti@example.com",
        password: "654321",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/siti-sheet-id/edit"
      }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    result = await request(app.base, "/api/admin/sales", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Budi",
        email: "budi@example.com",
        password: "112233",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/budi-sheet-id/edit"
      }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));

    const salesCookie = await login(app.base, "sales", "siti@example.com", "654321");
    const oldLeadId = "code:LD-LAMA:081234000111";
    result = await request(app.base, "/api/leads", { cookie: salesCookie });
    assert.equal(result.data.leads.length, 1);
    assert.equal(result.data.leads[0].nameUser, "Lead Sebelumnya");
    assert.equal(result.data.leads[0].followUps[1].result, "Pernah dihubungi");
    assert.equal(result.data.leads[0].visitBooked, true);
    assert.equal(result.data.leads[0].visitDate, "");
    assert.equal(result.data.leads[0].visitPlannedAt, "");
    assert.equal(result.data.leads[0].visitAvailable, true);
    assert.equal(result.data.leads[0].visitCompleted, false);

    result = await request(app.base, `/api/leads/${oldLeadId}`, {
      method: "PATCH",
      cookie: salesCookie,
      body: {
        nameUser: "Lead Lama Diperbarui",
        phone: "081234000111",
        domicile: "Sidoarjo",
        source: "Instagram",
        leadCode: "LD-LAMA"
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.lead.domicile, "Sidoarjo");

    result = await request(app.base, `/api/leads/${oldLeadId}/visit-plan`, {
      method: "PATCH",
      cookie: salesCookie,
      body: { visitBooked: false }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.lead.visitBooked, false);
    assert.equal(result.data.lead.visitPlannedAt, "");

    result = await request(app.base, `/api/leads/${oldLeadId}/visit-plan`, {
      method: "PATCH",
      cookie: salesCookie,
      body: { visitBooked: true }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.lead.visitBooked, true);
    assert.ok(Date.parse(result.data.lead.visitPlannedAt));
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[0][26], "Tanggal Rencana Visit");
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[1][15], true);
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[1][26], result.data.lead.visitPlannedAt);

    result = await request(app.base, "/api/leads", {
      method: "POST",
      cookie: salesCookie,
      body: { nameUser: "Dina", phone: "08123456789", domicile: "Surabaya", followUpDate: lateDate }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    const leadId = result.data.lead.id;
    assert.equal(result.data.lead.followUps[0].late, true);

    result = await request(app.base, `/api/leads/${leadId}`, {
      method: "PATCH",
      cookie: salesCookie,
      body: {
        nameUser: "Dina Diperbarui",
        phone: "08123456789",
        domicile: "Surabaya",
        source: "Instagram",
        leadCode: ""
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));

    result = await request(app.base, `/api/leads/${leadId}/follow-ups`, {
      method: "POST",
      cookie: salesCookie,
      body: {
        number: 2,
        followUpDate: dateInJakarta(),
        result: "Sudah dihubungi"
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    result = await request(app.base, `/api/leads/${oldLeadId}/follow-ups`, {
      method: "POST",
      cookie: salesCookie,
      body: {
        number: 3,
        followUpDate: hPlusTwoDate,
        result: "FU lama diteruskan"
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.lead.followUps[2].late, false);
    result = await request(app.base, `/api/leads/${oldLeadId}/follow-ups`, {
      method: "POST",
      cookie: salesCookie,
      body: {
        number: 8,
        followUpDate: lateDate,
        result: "FU terakhir terlambat"
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.lead.followUps.find((item) => item.number === 8).late, true);

    const budiCookie = await login(app.base, "sales", "budi@example.com", "112233");
    result = await request(app.base, "/api/leads", { cookie: budiCookie });
    assert.deepEqual(result.data.leads, []);
    result = await request(app.base, "/api/leads", {
      method: "POST",
      cookie: budiCookie,
      body: {
        nameUser: "Lead Budi",
        phone: "081234000222",
        followUpDate: dateInJakarta()
      }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    const budiLeadId = result.data.lead.id;
    result = await request(app.base, `/api/leads/${budiLeadId}/follow-ups`, {
      method: "POST",
      cookie: budiCookie,
      body: {
        number: 2,
        followUpDate: dateInJakarta(),
        result: "Follow-up Budi"
      }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    await new Promise((resolve) => app.server.close(resolve));

    const restarted = await import("../server.mjs?spreadsheet-test=restart");
    app = await start(restarted.handleRequest);
    result = await request(app.base, "/api/leads", { cookie: salesCookie });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.leads.length, 2);
    const afterRestartCookie = await login(app.base, "sales", "siti@example.com", "654321");
    result = await request(app.base, "/api/leads", { cookie: afterRestartCookie });
    assert.equal(result.data.leads.length, 2);
    const newLead = result.data.leads.find((lead) => lead.id === leadId);
    const existingLead = result.data.leads.find((lead) => lead.nameUser === "Lead Lama Diperbarui");
    assert.equal(newLead.followUps[1].result, "Sudah dihubungi");
    assert.equal(newLead.nameUser, "Dina Diperbarui");
    assert.equal(existingLead.followUps[2].result, "FU lama diteruskan");
    assert.equal(existingLead.followUps.find((item) => item.number === 8).result, "FU terakhir terlambat");
    assert.equal(existingLead.visitBooked, true);
    assert.equal(existingLead.visitPlannedAt, workbooks.get("siti-sheet-id").get("Input Harian")[1][26]);
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian").length, 3);
    assert.equal(workbooks.get("siti-sheet-id").has("leads"), false);
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[2][20], "Sudah dihubungi");
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[2][21], "");
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[1][20], "FU terakhir terlambat");
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[1][14], sheetDateSerial(lateDate));
    assert.equal(workbooks.get("siti-sheet-id").get("Input Harian")[1][21], "FU lama diteruskan");
    assert.equal(workbooks.get("test-spreadsheet").get("sales_accounts").length, 3);
    assert.equal(workbooks.get("budi-sheet-id").get("leads").length, 2);
    const budiAfterRestart = await login(app.base, "sales", "budi@example.com", "112233");
    result = await request(app.base, "/api/leads", { cookie: budiAfterRestart });
    assert.equal(result.data.leads.length, 1);
    assert.equal(result.data.leads[0].nameUser, "Lead Budi");
    assert.equal(result.data.leads[0].followUps[1].result, "Follow-up Budi");
  } finally {
    if (app) await new Promise((resolve) => app.server.close(resolve));
    globalThis.fetch = realFetch;
  }
});
