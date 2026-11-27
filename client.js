import { sundayToSaturdayRange, visitDateThisWeek } from "./visit-schedule.js";
import {
  computeDueFollowUp,
  hasFollowUpToday as leadHasFollowUpToday
} from "./follow-up-schedule.js";
import { whatsappChatUrl } from "./whatsapp-link.js";
import { leadsForDashboard } from "./leader-dashboard.js";

const state = {
  leads: [],
  sales: [],
  marketingLeaders: [],
  salesTeams: [],
  sourceOptions: [],
  user: null,
  loginRole: "sales",
  selectedFollowUp: 2,
  activePage: "overview",
  activeTeamId: null,
  leadFilter: "all",
  leadPage: 0,
  storageMode: "demo",
  editingLeadId: null,
  editingClosingLeadId: null,
  editingLeaderId: null
};
const API_REQUEST_TIMEOUT_MS = 90_000;
const LEAD_PAGE_SIZE = 50;
let appLoadingVisible = true;
let requestSequence = 0;
const activeRequests = new Map();
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

function setAppLoading(message) {
  appLoadingVisible = true;
  const overlay = byId("loading-overlay");
  byId("loading-message").textContent = message;
  overlay.classList.remove("is-hidden");
  overlay.setAttribute("aria-busy", "true");
  updateRequestProgress();
}

function clearAppLoading() {
  appLoadingVisible = false;
  const overlay = byId("loading-overlay");
  overlay.classList.add("is-hidden");
  overlay.setAttribute("aria-busy", "false");
  updateRequestProgress();
}

function requestLoadingMessage(path) {
  if (path === "/api/leads") {
    return state.storageMode === "spreadsheet"
      ? "Membaca leads dari Google Sheets..."
      : "Memuat data leads...";
  }
  if (path.startsWith("/api/admin/")) return "Memuat data akun...";
  if (path.startsWith("/api/auth/")) return "Memeriksa akun...";
  if (path === "/api/crm/options") return "Menyiapkan pilihan...";
  return "Menyimpan perubahan...";
}

function updateRequestProgress() {
  const progress = byId("request-progress");
  if (appLoadingVisible || activeRequests.size === 0) {
    progress.classList.add("is-hidden");
    progress.setAttribute("aria-busy", "false");
    return;
  }
  byId("request-progress-message").textContent = Array.from(activeRequests.values()).pop();
  progress.classList.remove("is-hidden");
  progress.setAttribute("aria-busy", "true");
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  const requestId = ++requestSequence;
  activeRequests.set(requestId, requestLoadingMessage(path));
  updateRequestProgress();
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Permintaan gagal.");
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Server terlalu lama merespons. Periksa koneksi Google Sheets, lalu coba lagi.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    activeRequests.delete(requestId);
    updateRequestProgress();
  }
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

function renderFollowUpSummary(lead) {
  const result = latestFollowUp(lead)?.result || lead.finalResult || "";
  const label = result || "Belum ada hasil FU";
  return `<td class="follow-up-summary"><strong>${safeText(lastActivity(lead))}</strong><small title="${safeText(label)}">${safeText(label)}</small></td>`;
}

function renderSourceOptions(selectId, selectedValue = "") {
  const select = byId(selectId);
  const options = [...state.sourceOptions];
  if (selectedValue && !options.includes(selectedValue)) options.push(selectedValue);
  select.innerHTML = `<option value="">Pilih sumber leads</option>${options.map((option) =>
    `<option value="${safeText(option)}">${safeText(option)}</option>`
  ).join("")}`;
  select.value = selectedValue;
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

function dueFollowUp(lead) {
  return computeDueFollowUp({ ...lead, createdAt: dateInputValue(lead.createdAt) }, todayLocal());
}

function needsFollowUp(lead) {
  return Boolean(dueFollowUp(lead));
}

function dueTimingLabel(due) {
  return due.daysOverdue === 0 ? "jatuh tempo hari ini" : `telat ${due.daysOverdue} hari`;
}

function leadStatus(lead) {
  const due = dueFollowUp(lead);
  return due ? `${due.label} · ${dueTimingLabel(due)}` : "Belum jatuh tempo";
}

function lastActivity(lead) {
  const item = latestFollowUp(lead);
  return item ? `FU ${item.number}` : "FU 1";
}

function displayableLeads() {
  return leadsForDashboard(state.leads, state.user?.role, state.activeTeamId).filter((lead) =>
    String(lead.nameUser || "").trim() && String(lead.phone || "").trim()
  );
}

function canEditLead(lead) {
  return state.user?.role === "sales" ||
    (state.user?.role === "leader" && lead.isOwnLead === true);
}

function isFollowedUp(lead) {
  return lead.followUps.some((item) => item.number > 1 && item.result);
}

function hasFollowUpToday(lead) {
  return leadHasFollowUpToday(lead, todayLocal());
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
    `${lead.nameUser} ${lead.phone} ${lead.domicile} ${lead.salesName || ""}`
      .toLocaleLowerCase("id").includes(normalizedQuery)
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / LEAD_PAGE_SIZE) - 1);
  if (!isOverview && state.leadPage > maxPage) state.leadPage = maxPage;
  const pageStart = isOverview ? 0 : state.leadPage * LEAD_PAGE_SIZE;
  const visibleLeads = isOverview
    ? filtered
    : filtered.slice(pageStart, pageStart + LEAD_PAGE_SIZE);
  const empty = byId(targetId === "leads-table-body" ? "empty-state" : "empty-state-all");
  const count = byId(targetId === "leads-table-body" ? "table-count" : "table-count-all");

  body.innerHTML = visibleLeads.map((lead, index) => {
    const colors = ["avatar-indigo", "avatar-green", "avatar-amber"];
    const columns = includePhone ? `<td>${safeText(lead.phone)}</td>` : "";
    const displayName = String(lead.nameUser || "").trim() || String(lead.phone || "").trim();
    const secondary = state.user?.role === "leader"
      ? `Sales: ${lead.salesName || "Belum diketahui"}`
      : lead.nameUser
        ? lead.leadCode || lead.phone || "Lead baru"
        : "Nama belum diisi";
    const whatsappUrl = whatsappChatUrl(lead.phone);
    const whatsappAction = whatsappUrl
      ? `<a class="row-action whatsapp-action" href="${safeText(whatsappUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Buka WhatsApp untuk ${safeText(displayName)}" title="Chat WhatsApp">WA</a>`
      : "";
    const editActions = canEditLead(lead)
      ? `<button class="row-action" type="button" data-edit-lead="${safeText(lead.id)}" aria-label="Edit data ${safeText(lead.nameUser)}" title="Edit lead">✎</button><button class="row-action" type="button" data-follow-up="${safeText(lead.id)}" aria-label="Catat follow-up untuk ${safeText(lead.nameUser)}" title="Catat hasil follow-up">›</button>`
      : "";
    const actions = whatsappAction || editActions
      ? `<div class="row-actions">${whatsappAction}${editActions}</div>`
      : "—";
    return `<tr>
      <td><div class="user-cell"><span class="avatar ${colors[index % colors.length]}">${safeText(initials(displayName))}</span><span class="user-info"><strong>${safeText(displayName)}</strong><small>${safeText(secondary)}</small></span></div></td>
      ${columns}
      <td>${safeText(lead.domicile || "—")}</td>
      <td><span class="source-pill">${safeText(lead.source || "Lainnya")}</span></td>
      <td>${renderIndicator(lead.indicator)}</td>
      <td>${renderVisitToggle(lead)}</td>
      <td>${renderVisitCompletedToggle(lead)}</td>
      <td>${renderClosingButton(lead)}</td>
      ${renderFollowUpSummary(lead)}
      <td><span class="status-pill ${needsFollowUp(lead) ? "status-due" : "status-not-due"}">${leadStatus(lead)}</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
  empty.classList.toggle("is-hidden", filtered.length > 0);
  count.textContent = isOverview
    ? `${filtered.length} lead${filtered.length === 1 ? "" : "s"} terbaru`
    : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`;
  if (!isOverview) {
    const pagination = byId("lead-pagination");
    const pageEnd = pageStart + visibleLeads.length;
    pagination.classList.toggle("is-hidden", filtered.length === 0);
    byId("lead-pagination-count").textContent =
      `Menampilkan ${pageStart + 1}-${pageEnd} dari ${filtered.length.toLocaleString("id-ID")} leads`;
    byId("previous-lead-page").disabled = state.leadPage === 0;
    byId("next-lead-page").disabled = pageEnd >= filtered.length;
    byId("lead-page-number").textContent = `Halaman ${state.leadPage + 1} dari ${maxPage + 1}`;
    updateLeadFilterSummary();
  }
}

function renderIndicator(value) {
  const indicator = String(value || "").trim().toUpperCase();
  if (!["COLD", "WARM", "HOT"].includes(indicator)) {
    return '<span class="indicator-pill indicator-empty">—</span>';
  }
  return `<span class="indicator-pill indicator-${indicator.toLowerCase()}">${indicator}</span>`;
}

function renderVisitToggle(lead) {
  const checked = Boolean(lead.visitBooked);
  const readOnly = !canEditLead(lead);
  const unavailable = readOnly || lead.visitAvailable === false;
  const action = checked ? "Batalkan janji visit" : "Buat janji visit";
  const label = checked ? "Janji visit" : "Rencana visit";
  const title = readOnly
    ? "Akun ini hanya dapat melihat data"
    : "Kolom Rencana Visit tidak ditemukan di spreadsheet";
  return `<button class="visit-toggle${checked ? " is-checked" : ""}" type="button" data-toggle-visit="${safeText(lead.id)}" aria-label="${action}" aria-pressed="${checked}"${unavailable ? ` disabled title="${title}"` : ""}><span class="visit-checkmark" aria-hidden="true">${checked ? "✓" : "+"}</span><span>${label}</span></button>`;
}

function renderVisitCompletedToggle(lead) {
  const checked = Boolean(lead.visitCompleted);
  const canToggle = canEditLead(lead) && (lead.visitBooked || checked);
  const title = !canEditLead(lead)
    ? "Akun ini hanya dapat melihat data"
    : canToggle ? "" : "Buat Rencana Visit terlebih dahulu";
  return `<button class="visit-toggle visit-completed-toggle${checked ? " is-checked" : ""}" type="button" data-toggle-visit-completed="${safeText(lead.id)}" aria-pressed="${checked}"${canToggle ? "" : ` disabled title="${title}"`}><span class="visit-checkmark" aria-hidden="true">${checked ? "✓" : "+"}</span><span>${checked ? "Terlaksana" : "Visit terlaksana"}</span></button>`;
}

function renderClosingButton(lead) {
  const readOnly = !canEditLead(lead);
  const label = lead.blockBooking ? `Closing · ${lead.blockBooking}` : "Closing";
  return `<button class="button button-secondary closing-button" type="button" data-closing="${safeText(lead.id)}"${readOnly ? ' disabled title="Akun ini hanya dapat melihat data"' : " title=\"Isi atau ubah blok booking\""}>${safeText(label)}</button>`;
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
  byId("follow-up-alert-message").textContent = `${dueLeads.length} lead butuh Follow Up`;
}

function renderPriorityVisits() {
  const [weekStart, weekEnd] = sundayToSaturdayRange(todayLocal());
  const planned = displayableLeads().filter((lead) => lead.visitBooked && !lead.visitCompleted);
  const scheduled = planned
    .map((lead) => ({ lead, date: visitDateThisWeek(lead, weekStart) }))
    .filter(({ date }) => date && date >= weekStart && date <= weekEnd)
    .sort((left, right) => left.date.localeCompare(right.date));
  const missingDayCount = planned.filter((lead) => !visitDateThisWeek(lead, weekStart)).length;
  const list = byId("priority-visit-list");
  const empty = byId("priority-visit-empty");
  const note = byId("priority-visit-note");
  byId("priority-visit-count").textContent = `${scheduled.length} minggu ini`;
  list.innerHTML = scheduled.map(({ lead, date }, index) => {
    const name = String(lead.nameUser || "").trim() || String(lead.phone || "").trim();
    const visitDate = formatDate(date);
    const color = ["avatar-indigo", "avatar-green", "avatar-amber"][index % 3];
    return `<article class="priority-visit-row">
      <div class="priority-visit-person"><span class="avatar ${color}">${safeText(initials(name))}</span><div><strong>${safeText(name)}</strong><small>${safeText([lead.phone, lead.domicile].filter(Boolean).join(" · ") || "Detail lead belum lengkap")}</small></div></div>
      <div class="priority-visit-date"><span>Hari rencana visit</span><strong>${safeText(visitDate)}</strong></div>
      <button class="button button-secondary visit-action" type="button" data-follow-up="${safeText(lead.id)}">Buka lead</button>
    </article>`;
  }).join("");
  empty.classList.toggle("is-hidden", scheduled.length > 0);
  note.classList.toggle("is-hidden", missingDayCount === 0);
  note.textContent = missingDayCount
    ? `${missingDayCount} lead sudah dicentang untuk visit, tetapi harinya belum disebut pada hasil FU. Tulis, misalnya, “Janji visit hari Minggu” pada hasil FU.`
    : "";
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
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
  const leads = displayableLeads().filter((lead) =>
    state.user?.role !== "leader" || lead.isOwnLead === true
  );
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
  const activeTeam = state.salesTeams.find((team) => team.id === state.activeTeamId);
  byId("welcome-heading").innerHTML = activeTeam
    ? safeText(`Tim Sales (${activeTeam.name})`)
    : `Hai, <span id="welcome-name">${safeText(state.user?.name || "Anisa")}</span> <span class="wave" aria-hidden="true">✦</span>`;
  byId("overview-page").querySelector(".welcome-row .muted").textContent = activeTeam
    ? `Ringkasan leads dan aktivitas sales ${activeTeam.name}.`
    : state.user?.role === "leader"
      ? "Ringkasan khusus leads milikmu. Pilih tim sales untuk melihat dashboard terpisah."
      : "Pantau leads dan tindak lanjutmu hari ini.";
  document.querySelectorAll('[data-nav="leads"]').forEach((button) => {
    if (activeTeam) button.dataset.teamScope = "true";
    else delete button.dataset.teamScope;
  });
  document.querySelectorAll("[data-open-form='new-lead']").forEach((button) => {
    button.classList.toggle("is-hidden", state.user?.role === "leader" && Boolean(activeTeam));
  });
  renderMetrics();
  renderPriorityVisits();
  renderLeadRows("leads-table-body", byId("lead-search").value);
  if (state.activePage === "leads") {
    renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
  }
  if (state.activePage === "follow-up") renderLeadOptions();
}

byId("today-date").textContent = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
}).format(new Date()).toLocaleUpperCase("id");

function showPage(page, teamId = null) {
  state.activeTeamId = teamId;
  const activeTeam = state.salesTeams.find((team) => team.id === teamId);
  const labels = { overview: "Ringkasan", leads: "Data leads", "follow-up": "Follow-up", admin: "Kelola sales" };
  state.activePage = page;
  for (const [id, key] of [["overview-page", "overview"], ["leads-page", "leads"], ["follow-up-page", "follow-up"], ["admin-page", "admin"]]) {
    byId(id).classList.toggle("is-hidden", page !== key);
  }
  byId("breadcrumb-current").textContent = activeTeam
    ? `Tim Sales (${activeTeam.name}) / ${labels[page] || labels.overview}`
    : labels[page];
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const isTeam = button.hasAttribute("data-team-id");
    button.classList.toggle("is-active", isTeam
      ? button.dataset.teamId === teamId
      : !teamId && button.dataset.nav === page);
  });
  if (page === "overview" || page === "leads") render();
  else if (page === "follow-up") renderLeadOptions();
}

function showToast(message, variant = "success") {
  const toast = document.createElement("div");
  toast.className = `toast${variant === "error" ? " toast-error" : ""}`;
  toast.textContent = message;
  byId("toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function setFormError(id, message) {
  const error = byId(id);
  error.textContent = message;
  error.classList.toggle("is-hidden", !message);
}

async function loadLeads({ blocking = false } = {}) {
  if (blocking) {
    setAppLoading(state.storageMode === "spreadsheet"
      ? "Membaca leads dari Google Sheets..."
      : "Memuat data leads...");
  }
  try {
    const data = await api("/api/leads");
    state.leads = data.leads;
    state.salesTeams = data.teams || [];
    renderLeaderTeamNav();
    render();
  } finally {
    if (blocking) clearAppLoading();
  }
}

function renderLeaderTeamNav() {
  const markup = state.salesTeams.map((team) =>
    `<button class="nav-item" data-nav="team" data-team-id="${safeText(team.id)}" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M17 5.5a3.5 3.5 0 0 1 0 6.8M18 14a5 5 0 0 1 3 4.6V20"/></svg><span>Tim Sales (${safeText(team.name)})</span></button>`
  ).join("");
  const mobileMarkup = state.salesTeams.map((team) =>
    `<button class="mobile-nav-item" data-nav="team" data-team-id="${safeText(team.id)}" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/></svg><span>Tim Sales (${safeText(team.name)})</span></button>`
  ).join("");
  byId("leader-team-nav").innerHTML = markup;
  byId("mobile-leader-team-nav").innerHTML = mobileMarkup;
  const showTeams = state.user?.role === "leader" && state.salesTeams.length > 0;
  byId("leader-team-nav").classList.toggle("is-hidden", !showTeams);
  byId("mobile-leader-team-nav").classList.toggle("is-hidden", !showTeams);
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

function renderLeaderSalesOptions(selectedIds = []) {
  const activeSales = state.sales.filter((account) => account.isActive);
  byId("leader-sales-options").innerHTML = activeSales.length
    ? activeSales.map((account) => `
      <label class="leader-sales-option">
        <input type="checkbox" name="leader-sales" value="${safeText(account.id)}"${selectedIds.includes(account.id) ? " checked" : ""}>
        <span>${safeText(account.name)}</span>
      </label>`).join("")
    : '<span class="muted">Belum ada sales aktif.</span>';
}

function renderMarketingLeaders() {
  const activeCount = state.marketingLeaders.filter((leader) => leader.isActive).length;
  byId("leaders-count").textContent = `${activeCount} leader aktif`;
  byId("leaders-empty").classList.toggle("is-hidden", state.marketingLeaders.length > 0);
  byId("leaders-table-body").innerHTML = state.marketingLeaders.map((leader) => {
    const assignedSales = leader.salesIds
      .map((id) => state.sales.find((account) => account.id === id)?.name)
      .filter(Boolean);
    return `<tr>
      <td><div class="user-cell"><span class="avatar avatar-green">${safeText(initials(leader.name))}</span><span class="user-info"><strong>${safeText(leader.name)}</strong><small>Leader marketing</small></span></div></td>
      <td>${safeText(leader.email)}</td>
      <td>${leader.spreadsheetUrl
        ? `<a class="sheet-link" href="${safeText(leader.spreadsheetUrl)}" target="_blank" rel="noopener noreferrer">Buka spreadsheet ↗</a>`
        : "Belum diatur"}</td>
      <td>${safeText(assignedSales.join(", ") || "Tidak ada sales aktif")}</td>
      <td><span class="status-pill ${leader.isActive ? "status-not-due" : "status-due"}">${leader.isActive ? "Aktif" : "Nonaktif"}</span></td>
      <td><div class="leader-row-actions"><button class="button button-secondary account-state-button" type="button" data-edit-leader-id="${safeText(leader.id)}">Atur sales</button><button class="button button-secondary account-state-button" type="button" data-leader-id="${safeText(leader.id)}" data-next-active="${!leader.isActive}">${leader.isActive ? "Nonaktifkan" : "Aktifkan"}</button></div></td>
    </tr>`;
  }).join("");
}

async function loadSalesAccounts({ blocking = false } = {}) {
  if (blocking) {
    setAppLoading(state.storageMode === "spreadsheet"
      ? "Membaca akun sales dan leader dari Google Sheets..."
      : "Memuat data akun...");
  }
  try {
    const data = await api("/api/admin/sales");
    state.sales = data.sales;
    renderSalesAccounts();
    renderLeaderSalesOptions();
    const leaders = await api("/api/admin/leaders");
    state.marketingLeaders = leaders.leaders;
    renderMarketingLeaders();
  } finally {
    if (blocking) clearAppLoading();
  }
}

function enterWorkspace(user, initialLoad = false) {
  state.user = user;
  byId("login-view").classList.add("is-hidden");
  byId("app-shell").classList.remove("is-hidden");
  byId("app-shell").classList.toggle("is-admin", user.role === "admin");
  byId("app-shell").classList.toggle("is-leader", user.role === "leader");
  byId("profile-name").textContent = user.name;
  byId("profile-avatar").textContent = initials(user.name);
  byId("profile-role").textContent = user.role === "admin"
    ? "Administrator"
    : user.role === "leader" ? "Leader marketing" : user.email;
  byId("welcome-name").textContent = user.name;
  byId("overview-page").querySelector(".muted").textContent = user.role === "leader"
    ? "Ringkasan khusus leads milikmu. Pilih tim sales untuk melihat dashboard terpisah."
    : "Pantau leads dan tindak lanjutmu hari ini.";

  const isAdmin = user.role === "admin";
  const isLeader = user.role === "leader";
  const isSales = user.role === "sales";
  byId("admin-nav").classList.toggle("is-hidden", !isAdmin);
  byId("mobile-admin-nav").classList.toggle("is-hidden", !isAdmin);
  document.querySelectorAll(".sales-only").forEach((item) =>
    item.classList.toggle("is-hidden", !isSales && !isLeader)
  );
  document.querySelectorAll(".sales-or-leader").forEach((item) =>
    item.classList.toggle("is-hidden", !isSales && !isLeader)
  );
  byId("sheet-status-label").textContent = state.storageMode === "spreadsheet"
    ? "Tersinkron · Google Sheets"
    : "Data demo · lokal";
  document.querySelectorAll(".demo-banner").forEach((banner) => {
    banner.classList.toggle("is-hidden", state.storageMode === "spreadsheet");
  });
  byId("mode-label").textContent = state.storageMode === "spreadsheet" ? " GOOGLE SHEETS" : " DEMO LOKAL";
  renderLeaderTeamNav();
  if (isAdmin) {
    showPage("admin");
    loadSalesAccounts({ blocking: initialLoad }).catch((error) => showToast(error.message, "error"));
  } else {
    showPage("overview");
    loadLeads({ blocking: initialLoad }).catch((error) => showToast(error.message, "error"));
  }
}

function selectLoginRole(role) {
  state.loginRole = role;
  document.querySelectorAll("[data-login-role]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.loginRole === role);
  });
  if (state.storageMode === "spreadsheet") {
    byId("login-email").value = "";
    byId("login-password").value = "";
    byId("login-demo-hint").innerHTML = role === "leader"
      ? "<strong>Akun leader marketing</strong><br>Dibuat oleh admin."
      : role === "admin"
        ? "<strong>Akun administrator</strong><br>Gunakan kredensial admin."
        : "<strong>Akun sales</strong><br>Dibuat oleh admin.";
  } else if (role === "admin") {
    byId("login-email").value = "admin@demo.local";
    byId("login-password").value = "246810";
    byId("login-demo-hint").innerHTML = "<strong>Akun demo admin</strong><br>admin@demo.local · 246810";
  } else if (role === "leader") {
    byId("login-email").value = "";
    byId("login-password").value = "";
    byId("login-demo-hint").innerHTML = "<strong>Akun leader marketing</strong><br>Dibuat oleh admin.";
  } else {
    byId("login-email").value = "anisa@demo.local";
    byId("login-password").value = "123456";
    byId("login-demo-hint").innerHTML = "<strong>Akun demo sales</strong><br>anisa@demo.local · 123456";
  }
  setFormError("login-error", "");
}

document.querySelectorAll("[data-login-role]").forEach((button) => {
  button.addEventListener("click", () => selectLoginRole(button.dataset.loginRole));
});

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormError("login-error", "");
  setAppLoading("Memeriksa akun...");
  try {
    const user = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        role: state.loginRole,
        email: byId("login-email").value,
        password: byId("login-password").value
      })
    });
    enterWorkspace(user.user, true);
  } catch (error) {
    clearAppLoading();
    setFormError("login-error", error.message);
  }
});

document.querySelectorAll("[data-lead-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.leadFilter = button.dataset.leadFilter;
    state.leadPage = 0;
    byId("lead-search-all").value = "";
    showPage("leads", state.activeTeamId);
  });
});

byId("clear-lead-filter").addEventListener("click", () => {
  state.leadFilter = "all";
  state.leadPage = 0;
  byId("lead-search-all").value = "";
  renderLeadRows("leads-table-all", "", true);
});

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    const teamId = button.hasAttribute("data-team-scope") ? state.activeTeamId : null;
    if (button.dataset.nav === "leads") {
      state.leadFilter = "all";
      state.leadPage = 0;
      byId("lead-search-all").value = "";
    }
    showPage(button.dataset.nav, teamId);
  });
});

document.addEventListener("click", (event) => {
  const teamButton = event.target.closest("[data-team-id]");
  if (!teamButton) return;
  byId("lead-search").value = "";
  byId("lead-search-all").value = "";
  state.leadFilter = "all";
  showPage("overview", teamButton.dataset.teamId);
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
byId("lead-search-all").addEventListener("input", (event) => {
  state.leadPage = 0;
  renderLeadRows("leads-table-all", event.target.value, true);
});
byId("previous-lead-page").addEventListener("click", () => {
  state.leadPage = Math.max(0, state.leadPage - 1);
  renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
});
byId("next-lead-page").addEventListener("click", () => {
  state.leadPage += 1;
  renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
});

document.addEventListener("click", (event) => {
  const editAction = event.target.closest("[data-edit-lead]");
  if (editAction) {
    const lead = state.leads.find((item) => item.id === editAction.dataset.editLead);
    if (!lead || !canEditLead(lead)) return;
    state.editingLeadId = lead.id;
    byId("edit-lead-name").value = lead.nameUser;
    byId("edit-lead-phone").value = lead.phone;
    byId("edit-lead-domicile").value = lead.domicile || "";
    renderSourceOptions("edit-lead-source", lead.source || "");
    byId("edit-lead-code").value = lead.leadCode || "";
    byId("edit-lead-tahap").value = lead.tahap || "Komunikasi";
    byId("edit-lead-catatan").value = lead.catatan || "";
    setFormError("edit-lead-error", "");
    byId("edit-lead-modal").showModal();
    return;
  }
  const action = event.target.closest("[data-follow-up]");
  if (!action) return;
  const selectedLead = state.leads.find((lead) => lead.id === action.dataset.followUp);
  if (!selectedLead || !canEditLead(selectedLead)) return;
  showPage("follow-up");
  byId("follow-up-lead").value = action.dataset.followUp;
  state.selectedFollowUp = Number(action.dataset.followUpNumber) ||
    nextFollowUpNumber(state.leads.find((lead) => lead.id === action.dataset.followUp));
  renderFollowUpPicker();
  syncSelectedFollowUpFields();
  renderSelectedLead();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-visit]");
  if (!button) return;
  const lead = state.leads.find((item) => item.id === button.dataset.toggleVisit);
  if (!lead || !canEditLead(lead) || lead.visitAvailable === false) return;
  button.disabled = true;
  try {
    await api(`/api/leads/${encodeURIComponent(lead.id)}/visit-plan`, {
      method: "PATCH",
      body: JSON.stringify({ visitBooked: !lead.visitBooked })
    });
    await loadLeads();
    showToast(lead.visitBooked ? "Rencana visit dibatalkan." : "Rencana visit dicatat.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-visit-completed]");
  if (!button) return;
  const lead = state.leads.find((item) => item.id === button.dataset.toggleVisitCompleted);
  if (!lead || !canEditLead(lead) || (!lead.visitBooked && !lead.visitCompleted)) return;
  button.disabled = true;
  try {
    await api(`/api/leads/${encodeURIComponent(lead.id)}/visit-completed`, {
      method: "PATCH",
      body: JSON.stringify({ visitCompleted: !lead.visitCompleted })
    });
    await loadLeads();
    showToast(lead.visitCompleted
      ? "Status visit terlaksana dibatalkan."
      : "Visit berhasil ditandai terlaksana.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-closing]");
  if (!button) return;
  const lead = state.leads.find((item) => item.id === button.dataset.closing);
  if (!lead || !canEditLead(lead)) return;
  state.editingClosingLeadId = lead.id;
  byId("closing-block").value = lead.blockBooking || "";
  setFormError("closing-error", "");
  byId("closing-modal").showModal();
});

document.querySelectorAll(".close-closing-modal").forEach((button) => {
  button.addEventListener("click", () => byId("closing-modal").close());
});
byId("closing-modal").addEventListener("click", (event) => {
  if (event.target === byId("closing-modal")) byId("closing-modal").close();
});
byId("closing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormError("closing-error", "");
  try {
    await api(`/api/leads/${encodeURIComponent(state.editingClosingLeadId)}/closing`, {
      method: "PATCH",
      body: JSON.stringify({ blockBooking: byId("closing-block").value })
    });
    await loadLeads();
    byId("closing-modal").close();
    showToast("Blok booking berhasil disimpan dan status lead menjadi Closing.");
  } catch (error) {
    setFormError("closing-error", error.message);
  }
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
        leadCode: byId("edit-lead-code").value,
        tahap: byId("edit-lead-tahap").value,
        catatan: byId("edit-lead-catatan").value
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
  state.marketingLeaders = [];
  state.salesTeams = [];
  state.activeTeamId = null;
  byId("app-shell").classList.remove("is-admin", "is-leader");
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

byId("open-add-leader").addEventListener("click", () => {
  state.editingLeaderId = null;
  byId("add-leader-form").reset();
  byId("leader-account-fields").classList.remove("is-hidden");
  byId("leader-account-fields").querySelectorAll("input").forEach((input) => { input.disabled = false; });
  byId("leader-modal-title").textContent = "Daftarkan leader marketing";
  byId("leader-modal-description").textContent = "Leader mengelola spreadsheet sendiri dan memantau sales yang dipilih.";
  byId("leader-submit-button").textContent = "Simpan akun leader";
  renderLeaderSalesOptions();
  byId("add-leader-modal").showModal();
});
document.querySelectorAll(".close-leader-modal").forEach((button) => {
  button.addEventListener("click", () => byId("add-leader-modal").close());
});
byId("add-leader-modal").addEventListener("click", (event) => {
  if (event.target === byId("add-leader-modal")) byId("add-leader-modal").close();
});

byId("add-leader-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError("add-leader-error", "");
  const salesIds = [...document.querySelectorAll('input[name="leader-sales"]:checked')]
    .map((input) => input.value);
  try {
    if (state.editingLeaderId) {
      await api(`/api/admin/leaders/${encodeURIComponent(state.editingLeaderId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          salesIds,
          spreadsheetUrl: byId("leader-sheet").value
        })
      });
    } else {
      await api("/api/admin/leaders", {
        method: "POST",
        body: JSON.stringify({
          name: byId("leader-name").value,
          email: byId("leader-email").value,
          password: byId("leader-password").value,
          salesIds,
          spreadsheetUrl: byId("leader-sheet").value
        })
      });
    }
    await loadSalesAccounts();
    form.reset();
    byId("add-leader-modal").close();
    showToast(state.editingLeaderId
      ? "Sales yang dipantau berhasil diperbarui."
      : "Akun leader marketing berhasil dibuat.");
    state.editingLeaderId = null;
  } catch (error) {
    setFormError("add-leader-error", error.message);
  }
});

byId("leaders-table-body").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-leader-id]");
  if (editButton) {
    const leader = state.marketingLeaders.find((item) => item.id === editButton.dataset.editLeaderId);
    if (!leader) return;
    state.editingLeaderId = leader.id;
    byId("add-leader-form").reset();
    byId("leader-account-fields").classList.add("is-hidden");
    byId("leader-account-fields").querySelectorAll("input").forEach((input) => { input.disabled = true; });
    byId("leader-modal-title").textContent = `Atur sales untuk ${leader.name}`;
    byId("leader-modal-description").textContent = "Ubah spreadsheet milik leader atau sales yang dapat dipantaunya.";
    byId("leader-submit-button").textContent = "Simpan penugasan";
    byId("leader-sheet").value = leader.spreadsheetUrl || "";
    renderLeaderSalesOptions(leader.salesIds);
    byId("add-leader-modal").showModal();
    return;
  }
  const button = event.target.closest("[data-leader-id]");
  if (!button) return;
  try {
    await api(`/api/admin/leaders/${encodeURIComponent(button.dataset.leaderId)}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: button.dataset.nextActive === "true" })
    });
    await loadSalesAccounts();
    showToast(button.dataset.nextActive === "true"
      ? "Akun leader diaktifkan."
      : "Akses leader dinonaktifkan.");
  } catch (error) {
    showToast(error.message);
  }
});

setAppLoading("Menghubungkan ke server dan memeriksa sesi...");
api("/api/health").then(({ mode }) => {
  state.storageMode = mode;
  if (mode === "spreadsheet") {
    byId("login-footnote").textContent = "Data akun, leads, dan follow-up tersimpan di Google Sheets.";
  } else {
    byId("login-footnote").textContent = "Mode demo lokal. Data akan terhapus saat server dimulai ulang.";
  }
  selectLoginRole(state.loginRole);
  return api("/api/crm/options");
}).then(({ sumber }) => {
  if (!Array.isArray(sumber)) throw new Error("Opsi sumber leads tidak dapat dimuat.");
  state.sourceOptions = sumber;
  renderSourceOptions("lead-source");
  renderSourceOptions("edit-lead-source");
  return api("/api/auth/session");
}).then(({ user }) => {
  enterWorkspace(user, true);
}).catch((error) => {
  clearAppLoading();
  if (error.status !== 401) setFormError("login-error", error.message);
});

renderFollowUpPicker();
window.setInterval(() => {
  if (!byId("app-shell").classList.contains("is-hidden")) {
    renderMetrics();
    if (state.activePage === "overview") {
      renderLeadRows("leads-table-body", byId("lead-search").value);
    } else if (state.activePage === "leads") {
      renderLeadRows("leads-table-all", byId("lead-search-all").value, true);
    }
  }
}, 60_000);
