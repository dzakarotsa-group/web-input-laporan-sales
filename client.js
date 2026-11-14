const state = {
  leads: [],
  sales: [],
  user: null,
  loginRole: "sales",
  selectedFollowUp: 2,
  activePage: "overview",
  leadFilter: "all",
  storageMode: "demo",
  editingLeadId: null
};
const FOLLOW_UP_REMINDER_MS = 3 * 24 * 60 * 60 * 1000;
const leadFilterLabels = {
  month: "Leads bulan ini",
  due: "Perlu follow-up",
  contacted: "Leads di-follow-up",
  today: "FU hari ini"
};

const byId = (id) => document.getElementById(id);
const safeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[character]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function latestFollowUp(lead) {
  return [...lead.followUps]
    .filter((item) => item.result)
    .sort((a, b) => {
      const timeDifference = Date.parse(b.createdAt || lead.createdAt) - Date.parse(a.createdAt || lead.createdAt);
      return timeDifference || b.number - a.number;
    })[0];
}

function dateAfter(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function isLateEntry(dateValue) {
  return Boolean(dateValue) && todayLocal() > dateAfter(dateValue, 2);
}

function needsFollowUp(lead, now = Date.now()) {
  const lastActivity = latestFollowUp(lead);
  const lastActivityAt = Date.parse(lastActivity?.createdAt || lead.createdAt);
  return Number.isFinite(lastActivityAt) && now - lastActivityAt > FOLLOW_UP_REMINDER_MS;
}

function leadStatus(lead) {
  return needsFollowUp(lead) ? "Perlu di-follow-up" : "Belum jatuh tempo";
}

function lastActivity(lead) {
  const item = latestFollowUp(lead);
  return item ? `FU ${item.number}` : "FU 1";
}

function displayableLeads() {
  return state.leads.filter((lead) => String(lead.nameUser || "").trim() || String(lead.phone || "").trim());
}

function isFollowedUp(lead) {
  return lead.followUps.some((item) => item.number > 1 && item.result);
}

function hasFollowUpToday(lead) {
  return lead.followUps.some((item) =>
    (item.followUpDate || dateInputValue(item.createdAt)) === todayLocal()
  );
}

function matchesLeadFilter(lead) {
  switch (state.leadFilter) {
    case "month":
      return dateInputValue(lead.createdAt).startsWith(todayLocal().slice(0, 7));
    case "due":
      return needsFollowUp(lead);
    case "contacted":
      return isFollowedUp(lead);
    case "today":
      return hasFollowUpToday(lead);
    default:
      return true;
  }
}

function updateLeadFilterSummary() {
  const active = state.leadFilter !== "all";
  byId("lead-filter-tools").classList.toggle("is-hidden", !active);
  byId("lead-filter-label").textContent = active ? leadFilterLabels[state.leadFilter] : "";
}

function renderLeadRows(targetId, query = "", includePhone = false) {
  const body = byId(targetId);
  const normalizedQuery = query.trim().toLocaleLowerCase("id");
  const isOverview = targetId === "leads-table-body";
  const sortedLeads = displayableLeads().sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
  );
  const pageLeads = isOverview
    ? sortedLeads.slice(0, 5)
    : sortedLeads.filter(matchesLeadFilter);
  const filtered = pageLeads.filter((lead) =>
    `${lead.nameUser} ${lead.phone} ${lead.domicile}`.toLocaleLowerCase("id").includes(normalizedQuery)
  );
  const empty = byId(targetId === "leads-table-body" ? "empty-state" : "empty-state-all");
  const count = byId(targetId === "leads-table-body" ? "table-count" : "table-count-all");

  body.innerHTML = filtered.map((lead, index) => {
    const colors = ["avatar-indigo", "avatar-green", "avatar-amber"];
    const columns = includePhone ? `<td>${safeText(lead.phone)}</td>` : "";
    const displayName = String(lead.nameUser || "").trim() || String(lead.phone || "").trim();
    const secondary = lead.nameUser
      ? lead.leadCode || lead.phone || "Lead baru"
      : "Nama belum diisi";
    return `<tr>
      <td><div class="user-cell"><span class="avatar ${colors[index % colors.length]}">${safeText(initials(displayName))}</span><span class="user-info"><strong>${safeText(displayName)}</strong><small>${safeText(secondary)}</small></span></div></td>
      ${columns}
      <td>${safeText(lead.domicile || "—")}</td>
      <td><span class="source-pill">${safeText(lead.source || "Lainnya")}</span></td>
      <td>${safeText(lastActivity(lead))}</td>
      <td><span class="status-pill ${needsFollowUp(lead) ? "status-due" : "status-not-due"}">${leadStatus(lead)}</span></td>
      <td><div class="row-actions"><button class="row-action" type="button" data-edit-lead="${safeText(lead.id)}" aria-label="Edit data ${safeText(lead.nameUser)}">✎</button><button class="row-action" type="button" data-follow-up="${safeText(lead.id)}" aria-label="Buat atau edit follow-up untuk ${safeText(lead.nameUser)}">›</button></div></td>
    </tr>`;
  }).join("");
  empty.classList.toggle("is-hidden", filtered.length > 0);
  count.textContent = isOverview
    ? `${filtered.length} lead${filtered.length === 1 ? "" : "s"} terbaru`
    : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`;
  if (!isOverview) updateLeadFilterSummary();
}

function renderMetrics() {
  const leads = displayableLeads();
  const dueLeads = leads.filter((lead) => needsFollowUp(lead));
  const contacted = leads.filter(isFollowedUp).length;
  const todayCount = leads.filter(hasFollowUpToday).length;
  const currentMonth = todayLocal().slice(0, 7);
  byId("metric-total").textContent = leads.filter((lead) =>
    dateInputValue(lead.createdAt).startsWith(currentMonth)
  ).length;
  byId("metric-pending").textContent = dueLeads.length;
  byId("metric-contacted").textContent = contacted;
  byId("metric-today").textContent = todayCount;
  byId("nav-count").textContent = leads.length;
  const alert = byId("follow-up-alert");
  alert.classList.toggle("is-hidden", dueLeads.length === 0);
  byId("follow-up-alert-message").textContent = `${dueLeads.length} lead sudah lebih dari 3 hari tanpa FU terbaru.`;
}

function renderPriorityVisits() {
  const scheduled = displayableLeads()
    .filter((lead) => (lead.visitBooked || lead.visitDate) && !lead.visitCompleted)
    .sort((left, right) => {
      const leftDate = left.visitDate || "9999-12-31";
      const rightDate = right.visitDate || "9999-12-31";
      return leftDate.localeCompare(rightDate);
    });
  const list = byId("priority-visit-list");
  const empty = byId("priority-visit-empty");
  byId("priority-visit-count").textContent = `${scheduled.length} jadwal`;
  list.innerHTML = scheduled.map((lead, index) => {
    const name = String(lead.nameUser || "").trim() || String(lead.phone || "").trim();
    const visitDate = lead.visitDate ? formatDate(lead.visitDate) : "Tanggal belum ditentukan";
    const late = lead.visitDate && lead.visitDate < todayLocal();
    const color = ["avatar-indigo", "avatar-green", "avatar-amber"][index % 3];
    return `<article class="priority-visit-row">
      <div class="priority-visit-person"><span class="avatar ${color}">${safeText(initials(name))}</span><div><strong>${safeText(name)}</strong><small>${safeText([lead.phone, lead.domicile].filter(Boolean).join(" · ") || "Detail lead belum lengkap")}</small></div></div>
      <div class="priority-visit-date"><span>${late ? "Jadwal terlewat" : "Jadwal visit"}</span><strong${late ? ' class="visit-overdue"' : ""}>${safeText(visitDate)}</strong></div>
      <button class="button button-secondary visit-action" type="button" data-follow-up="${safeText(lead.id)}">Buka lead</button>
    </article>`;
  }).join("");
  empty.classList.toggle("is-hidden", scheduled.length > 0);
}

function nextFollowUpNumber(lead) {
  const recordedNumbers = new Set(lead?.followUps.map((item) => item.number) || [1]);
  for (let number = 2; number <= 8; number += 1) {
    if (!recordedNumbers.has(number)) return number;
  }
  return 8;
}

function renderFollowUpPicker() {
  const picker = byId("fu-picker");
  picker.innerHTML = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return `<button class="fu-option${number === state.selectedFollowUp ? " is-selected" : ""}" type="button" data-fu-number="${number}" aria-pressed="${number === state.selectedFollowUp}">FU ${number}</button>`;
  }).join("");
  byId("follow-up-number").value = String(state.selectedFollowUp);
}

function dateInputValue(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function updateLateEntryAlert() {
  byId("late-input-alert").classList.toggle("is-hidden", !isLateEntry(byId("follow-up-date").value));
}

function syncSelectedFollowUpFields() {
  const lead = state.leads.find((item) => item.id === byId("follow-up-lead").value);
  const item = lead?.followUps.find((followUp) => followUp.number === state.selectedFollowUp);
  byId("follow-up-date").value = item?.followUpDate || dateInputValue(item?.createdAt) || todayLocal();
  byId("follow-up-result").value = item?.result || "";
  byId("char-count").textContent = `${byId("follow-up-result").value.length}/1000`;
  updateLateEntryAlert();
}

function renderLeadOptions() {
  const select = byId("follow-up-lead");
  const currentId = select.value;
  const leads = displayableLeads();
  select.innerHTML = `<option value="">Pilih nama user</option>${leads.map((lead) => `<option value="${safeText(lead.id)}">${safeText(lead.nameUser || lead.phone)} · ${safeText(lead.phone)} · ${safeText(lead.domicile || "Domisili belum diisi")}</option>`).join("")}`;
  if (leads.some((lead) => lead.id === currentId)) select.value = currentId;
  if (!select.value && leads.length) select.value = leads[0].id;
  state.selectedFollowUp = nextFollowUpNumber(leads.find((lead) => lead.id === select.value));
  renderFollowUpPicker();
  syncSelectedFollowUpFields();
  renderSelectedLead();
}

function renderSelectedLead() {
  const lead = state.leads.find((item) => item.id === byId("follow-up-lead").value);
  const name = byId("preview-name");
  const details = byId("preview-details");
  const historyList = byId("history-list");
  if (!lead) {
    name.textContent = "Pilih lead";
    details.innerHTML = "";
    historyList.innerHTML = '<p class="history-empty">Belum ada follow-up tercatat.</p>';
    byId("history-count").textContent = "0";
    return;
  }

  name.textContent = lead.nameUser;
  details.innerHTML = [
    ["Nomor HP", lead.phone],
    ["Domisili", lead.domicile || "—"],
    ["Sumber leads", lead.source || "—"],
    ["Nama sales", lead.salesName || "—"]
  ].map(([label, value]) => `<div class="detail-row"><span>${label}</span><strong>${safeText(value)}</strong></div>`).join("");
  const history = [...lead.followUps].filter((item) => item.result).sort((a, b) => b.number - a.number);
  byId("history-count").textContent = String(history.length);
  historyList.innerHTML = history.length
    ? history.map((item) => {
      const late = item.late || isLateEntry(item.followUpDate);
      const dateLabel = formatDate(item.followUpDate || item.createdAt || lead.createdAt);
      return `<article class="history-item"><span class="history-index">${item.number}</span><div class="history-content"><strong>${item.number === 1 ? "FU 1 · Lead masuk" : `Follow-up ${item.number}`}</strong><p>${safeText(item.result)}</p><small>Tanggal FU: ${safeText(dateLabel)}${late ? ' · <span class="late-history-label">Terlambat input</span>' : ""}</small></div></article>`;
    }).join("")
    : '<p class="history-empty">Belum ada follow-up tercatat.</p>';
}

function formatDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(year, month - 1, day));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tanggal tidak tersedia" : new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function render() {
  renderMetrics();
  renderPriorityVisits();
  renderLeadRows("leads-table-body", byId("lead-search").value);
  renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
  renderLeadOptions();
}

byId("today-date").textContent = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
}).format(new Date()).toLocaleUpperCase("id");

function showPage(page) {
  const labels = { overview: "Ringkasan", leads: "Data leads", "follow-up": "Follow-up", admin: "Kelola sales" };
  state.activePage = page;
  for (const [id, key] of [["overview-page", "overview"], ["leads-page", "leads"], ["follow-up-page", "follow-up"], ["admin-page", "admin"]]) {
    byId(id).classList.toggle("is-hidden", page !== key);
  }
  byId("breadcrumb-current").textContent = labels[page];
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.nav === page);
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  byId("toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function setFormError(id, message) {
  const error = byId(id);
  error.textContent = message;
  error.classList.toggle("is-hidden", !message);
}

async function loadLeads() {
  const data = await api("/api/leads");
  state.leads = data.leads;
  render();
}

function renderSalesAccounts() {
  const activeCount = state.sales.filter((account) => account.isActive).length;
  byId("sales-count").textContent = `${activeCount} sales aktif`;
  byId("sales-empty").classList.toggle("is-hidden", state.sales.length > 0);
  byId("sales-table-body").innerHTML = state.sales.map((account) => `
    <tr>
      <td><div class="user-cell"><span class="avatar avatar-indigo">${safeText(initials(account.name))}</span><span class="user-info"><strong>${safeText(account.name)}</strong><small>${safeText(account.isActive ? "Akun sales" : "Akses dinonaktifkan")}</small></span></div></td>
      <td>${safeText(account.email)}</td>
      <td><a class="sheet-link" href="${safeText(account.spreadsheetUrl)}" target="_blank" rel="noopener noreferrer">Buka spreadsheet ↗</a></td>
      <td><span class="status-pill ${account.isActive ? "status-not-due" : "status-due"}">${account.isActive ? "Aktif" : "Nonaktif"}</span></td>
      <td><button class="button button-secondary account-state-button" type="button" data-account-id="${safeText(account.id)}" data-next-active="${!account.isActive}">${account.isActive ? "Nonaktifkan" : "Aktifkan"}</button></td>
    </tr>`).join("");
}

async function loadSalesAccounts() {
  const data = await api("/api/admin/sales");
  state.sales = data.sales;
  renderSalesAccounts();
}

function enterWorkspace(user) {
  state.user = user;
  byId("login-view").classList.add("is-hidden");
  byId("app-shell").classList.remove("is-hidden");
  byId("app-shell").classList.toggle("is-admin", user.role === "admin");
  byId("profile-name").textContent = user.name;
  byId("profile-avatar").textContent = initials(user.name);
  byId("profile-role").textContent = user.role === "admin" ? "Administrator" : user.email;
  byId("welcome-name").textContent = user.name;

  const isAdmin = user.role === "admin";
  byId("admin-nav").classList.toggle("is-hidden", !isAdmin);
  byId("mobile-admin-nav").classList.toggle("is-hidden", !isAdmin);
  document.querySelectorAll(".sales-only").forEach((item) => item.classList.toggle("is-hidden", isAdmin));
  byId("sheet-status-label").textContent = state.storageMode === "spreadsheet"
    ? "Tersinkron · Google Sheets"
    : "Data demo · lokal";
  document.querySelectorAll(".demo-banner").forEach((banner) => {
    banner.classList.toggle("is-hidden", state.storageMode === "spreadsheet");
  });
  byId("mode-label").textContent = state.storageMode === "spreadsheet" ? " GOOGLE SHEETS" : " DEMO LOKAL";
  if (isAdmin) {
    showPage("admin");
    loadSalesAccounts().catch((error) => showToast(error.message));
  } else {
    showPage("overview");
    loadLeads().catch((error) => showToast(error.message));
  }
}

document.querySelectorAll("[data-login-role]").forEach((button) => {
  button.addEventListener("click", () => {
    state.loginRole = button.dataset.loginRole;
    document.querySelectorAll("[data-login-role]").forEach((roleButton) => {
      roleButton.classList.toggle("is-active", roleButton === button);
    });
    const adminSelected = state.loginRole === "admin";
    byId("login-email").value = adminSelected ? "admin@demo.local" : "anisa@demo.local";
    byId("login-password").value = adminSelected ? "246810" : "123456";
    byId("login-demo-hint").innerHTML = adminSelected
      ? "<strong>Akun demo admin</strong><br>admin@demo.local · 246810"
      : "<strong>Akun demo sales</strong><br>anisa@demo.local · 123456";
    setFormError("login-error", "");
  });
});

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormError("login-error", "");
  try {
    const user = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        role: state.loginRole,
        email: byId("login-email").value,
        password: byId("login-password").value
      })
    });
    enterWorkspace(user.user);
  } catch (error) {
    setFormError("login-error", error.message);
  }
});

document.querySelectorAll("[data-lead-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.leadFilter = button.dataset.leadFilter;
    byId("lead-search-all").value = "";
    showPage("leads");
    renderLeadRows("leads-table-all", "", true);
  });
});

byId("clear-lead-filter").addEventListener("click", () => {
  state.leadFilter = "all";
  byId("lead-search-all").value = "";
  renderLeadRows("leads-table-all", "", true);
});

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.nav === "leads") {
      state.leadFilter = "all";
      byId("lead-search-all").value = "";
      renderLeadRows("leads-table-all", "", true);
    }
    showPage(button.dataset.nav);
  });
});

document.querySelectorAll("[data-open-form='new-lead']").forEach((button) => {
  button.addEventListener("click", () => {
    byId("lead-fu1-date").value = todayLocal();
    byId("lead-fu1-late").classList.add("is-hidden");
    byId("new-lead-modal").showModal();
  });
});

document.querySelectorAll(".close-modal").forEach((button) => {
  button.addEventListener("click", () => byId("new-lead-modal").close());
});

byId("new-lead-modal").addEventListener("click", (event) => {
  if (event.target === byId("new-lead-modal")) byId("new-lead-modal").close();
});

byId("lead-fu1-date").addEventListener("input", () => {
  byId("lead-fu1-late").classList.toggle("is-hidden", !isLateEntry(byId("lead-fu1-date").value));
});

byId("new-lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError("new-lead-error", "");
  const formData = new FormData(form);
  const input = Object.fromEntries(formData.entries());
  try {
    await api("/api/leads", { method: "POST", body: JSON.stringify(input) });
    await loadLeads();
    form.reset();
    byId("lead-sales").value = "Anisa";
    byId("lead-fu1-date").value = todayLocal();
    byId("new-lead-modal").close();
    showToast("Lead berhasil disimpan.");
  } catch (error) {
    setFormError("new-lead-error", error.message);
  }
});

byId("fu-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fu-number]");
  if (!button) return;
  state.selectedFollowUp = Number(button.dataset.fuNumber);
  renderFollowUpPicker();
  syncSelectedFollowUpFields();
});

byId("follow-up-lead").addEventListener("change", () => {
  const lead = state.leads.find((item) => item.id === byId("follow-up-lead").value);
  state.selectedFollowUp = nextFollowUpNumber(lead);
  renderFollowUpPicker();
  syncSelectedFollowUpFields();
  renderSelectedLead();
});
byId("follow-up-date").value = todayLocal();
byId("follow-up-date").addEventListener("input", () => {
  updateLateEntryAlert();
});
byId("follow-up-result").addEventListener("input", (event) => {
  byId("char-count").textContent = `${event.target.value.length}/1000`;
});

byId("follow-up-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormError("follow-up-error", "");
  const leadId = byId("follow-up-lead").value;
  if (!leadId) {
    setFormError("follow-up-error", "Pilih lead terlebih dahulu.");
    return;
  }
  try {
    await api(`/api/leads/${encodeURIComponent(leadId)}/follow-ups`, {
      method: "POST",
      body: JSON.stringify({
        number: Number(byId("follow-up-number").value),
        followUpDate: byId("follow-up-date").value,
        result: byId("follow-up-result").value
      })
    });
    await loadLeads();
    showToast("Tanggal dan hasil FU berhasil disimpan.");
  } catch (error) {
    setFormError("follow-up-error", error.message);
  }
});

byId("lead-search").addEventListener("input", (event) => renderLeadRows("leads-table-body", event.target.value));
byId("lead-search-all").addEventListener("input", (event) => renderLeadRows("leads-table-all", event.target.value, true));

document.addEventListener("click", (event) => {
  const editAction = event.target.closest("[data-edit-lead]");
  if (editAction) {
    const lead = state.leads.find((item) => item.id === editAction.dataset.editLead);
    if (!lead) return;
    state.editingLeadId = lead.id;
    byId("edit-lead-name").value = lead.nameUser;
    byId("edit-lead-phone").value = lead.phone;
    byId("edit-lead-domicile").value = lead.domicile || "";
    byId("edit-lead-source").value = lead.source || "";
    byId("edit-lead-code").value = lead.leadCode || "";
    setFormError("edit-lead-error", "");
    byId("edit-lead-modal").showModal();
    return;
  }
  const action = event.target.closest("[data-follow-up]");
  if (!action) return;
  showPage("follow-up");
  byId("follow-up-lead").value = action.dataset.followUp;
  state.selectedFollowUp = nextFollowUpNumber(state.leads.find((lead) => lead.id === action.dataset.followUp));
  renderFollowUpPicker();
  syncSelectedFollowUpFields();
  renderSelectedLead();
});

document.querySelectorAll(".close-edit-modal").forEach((button) => {
  button.addEventListener("click", () => byId("edit-lead-modal").close());
});
byId("edit-lead-modal").addEventListener("click", (event) => {
  if (event.target === byId("edit-lead-modal")) byId("edit-lead-modal").close();
});
byId("edit-lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormError("edit-lead-error", "");
  try {
    await api(`/api/leads/${encodeURIComponent(state.editingLeadId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        nameUser: byId("edit-lead-name").value,
        phone: byId("edit-lead-phone").value,
        domicile: byId("edit-lead-domicile").value,
        source: byId("edit-lead-source").value,
        leadCode: byId("edit-lead-code").value
      })
    });
    await loadLeads();
    byId("edit-lead-modal").close();
    showToast("Data lead berhasil diperbarui.");
  } catch (error) {
    setFormError("edit-lead-error", error.message);
  }
});

byId("dismiss-banner").addEventListener("click", () => byId("dismiss-banner").parentElement.remove());
byId("help-button").addEventListener("click", () => showToast(state.storageMode === "spreadsheet"
  ? "Akun dan data leads tersimpan di Google Sheets."
  : "Mode demo hanya tersedia secara lokal; hubungkan Google Sheets untuk menyimpan data online."));
byId("logout-button").addEventListener("click", async () => {
  let logoutError = "";
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    logoutError = error.message;
  }
  state.user = null;
  state.leads = [];
  state.sales = [];
  byId("app-shell").classList.add("is-hidden");
  byId("login-view").classList.remove("is-hidden");
  showPage("overview");
  if (logoutError) showToast(logoutError);
});

byId("open-add-sales").addEventListener("click", () => byId("add-sales-modal").showModal());
document.querySelectorAll(".close-sales-modal").forEach((button) => {
  button.addEventListener("click", () => byId("add-sales-modal").close());
});
byId("add-sales-modal").addEventListener("click", (event) => {
  if (event.target === byId("add-sales-modal")) byId("add-sales-modal").close();
});

byId("add-sales-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError("add-sales-error", "");
  const input = {
    name: byId("sales-name").value,
    email: byId("sales-email").value,
    password: byId("sales-password").value,
    spreadsheetUrl: byId("sales-sheet").value
  };
  try {
    await api("/api/admin/sales", { method: "POST", body: JSON.stringify(input) });
    await loadSalesAccounts();
    form.reset();
    byId("add-sales-modal").close();
    showToast("Akun sales berhasil dibuat.");
  } catch (error) {
    setFormError("add-sales-error", error.message);
  }
});

byId("sales-table-body").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-account-id]");
  if (!button) return;
  try {
    await api(`/api/admin/sales/${encodeURIComponent(button.dataset.accountId)}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: button.dataset.nextActive === "true" })
    });
    await loadSalesAccounts();
    showToast(button.dataset.nextActive === "true" ? "Akun sales diaktifkan." : "Akses sales dinonaktifkan.");
  } catch (error) {
    showToast(error.message);
  }
});

api("/api/health").then(({ mode }) => {
  state.storageMode = mode;
  if (mode === "spreadsheet") {
    byId("login-demo-hint").innerHTML = "<strong>Masuk dengan akun terdaftar</strong><br>Akun sales dibuat oleh admin.";
    byId("login-footnote").textContent = "Data akun, leads, dan follow-up tersimpan di Google Sheets.";
    byId("login-email").value = "";
    byId("login-password").value = "";
  } else {
    byId("login-footnote").textContent = "Mode demo lokal. Data akan terhapus saat server dimulai ulang.";
  }
}).catch((error) => {
  setFormError("login-error", error.message);
});

renderFollowUpPicker();
window.setInterval(() => {
  if (!byId("app-shell").classList.contains("is-hidden")) {
    renderMetrics();
    renderLeadRows("leads-table-body", byId("lead-search").value);
    renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
  }
}, 60_000);
