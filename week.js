const apiUrl = "https://script.google.com/macros/s/AKfycbzzv45buffPLa4e4tfs_Um5wjAHwSdbu27vaefMMRRe9qoyGU6qnC7oYcbOssf8_WqhsA/exec";
const maxPerDay = 4;
let registrations = [];
let weekStart = startOfWeek(new Date());

const weekList = document.querySelector("#weekList");
const weekLabel = document.querySelector("#weekLabel");
const weekStatus = document.querySelector("#weekStatus");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseScheduleDate(value) {
  if (value instanceof Date) return value;
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return new Date(raw);
}

function normalizeRegistration(item) {
  return { ...item, start: parseScheduleDate(item.start), end: parseScheduleDate(item.end) };
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  return { start, end };
}

function daySegment(item, date) {
  const bounds = dayBounds(date);
  const start = item.start > bounds.start ? item.start : bounds.start;
  const end = item.end < bounds.end ? item.end : bounds.end;
  return start < end ? { start, end } : null;
}

function timeRange(item, date) {
  const segment = daySegment(item, date);
  if (!segment) return "";
  const bounds = dayBounds(date);
  const start = segment.start.getTime() === bounds.start.getTime() ? "00:00" : `${pad2(segment.start.getHours())}:${pad2(segment.start.getMinutes())}`;
  const end = segment.end.getTime() === bounds.end.getTime() ? "24:00" : `${pad2(segment.end.getHours())}:${pad2(segment.end.getMinutes())}`;
  return `${start} → ${end}`;
}

function itemsForDate(date) {
  return registrations
    .filter((item) => daySegment(item, date))
    .sort((a, b) => a.start - b.start);
}

function dayStatus(items) {
  if (items.length >= maxPerDay) return ["Đông", "bad"];
  if (items.length === 0) return ["Trống", "warn"];
  if (items.length <= 2) return ["Ít", "good"];
  return ["Ổn", "good"];
}

function render() {
  const end = addDays(weekStart, 6);
  weekLabel.textContent = `${formatDate(weekStart)} - ${formatDate(end)}`;
  weekList.innerHTML = "";

  for (let index = 0; index < 7; index += 1) {
    const date = addDays(weekStart, index);
    const items = itemsForDate(date);
    const [label, cls] = dayStatus(items);
    const card = document.createElement("article");
    card.className = "week-day card";
    card.innerHTML = `
      <div class="week-day-head">
        <div>
          <strong>${["T2", "T3", "T4", "T5", "T6", "T7", "CN"][index]} · ${formatDate(date)}</strong>
          <small>${items.length} lượt</small>
        </div>
        <span class="badge ${cls}">${label}</span>
      </div>
      <div class="week-slots">
        ${items.length ? items.map((item) => `<div class="week-slot"><b>${timeRange(item, date)}</b><span>${item.name}${item.note ? ` · ${item.note}` : ""}</span></div>`).join("") : '<p class="empty">Chưa có lịch.</p>'}
      </div>
    `;
    weekList.appendChild(card);
  }
}

async function load() {
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    registrations = (data.registrations || []).map(normalizeRegistration).filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()));
    weekStatus.textContent = "Đã tải dữ liệu online.";
    render();
  } catch (error) {
    weekStatus.textContent = "Không tải được dữ liệu online.";
    render();
  }
}

document.querySelector("#prevWeek").addEventListener("click", () => {
  weekStart = addDays(weekStart, -7);
  render();
});

document.querySelector("#nextWeek").addEventListener("click", () => {
  weekStart = addDays(weekStart, 7);
  render();
});

load();
