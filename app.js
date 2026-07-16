const storeKey = "lich-tham-thay-v2";
const apiKey = "lich-tham-thay-api-url";
const maxPerDay = 4;

const state = loadState();
let apiUrl = "https://script.google.com/macros/s/AKfycbzzv45buffPLa4e4tfs_Um5wjAHwSdbu27vaefMMRRe9qoyGU6qnC7oYcbOssf8_WqhsA/exec";
let visibleDate = new Date();
visibleDate.setDate(1);
let selectedDetailDate = "";

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const dayDetail = $("#dayDetail");
const dayOverlay = $("#dayOverlay");
const monthLabel = $("#monthLabel");
const startDateInput = $("#startDateInput");
const endDateInput = $("#endDateInput");
const startTimeInput = { value: "", dataset: {} };
const endTimeInput = { value: "", dataset: {} };
const startHourSelect = $("#startHourSelect");
const startMinuteSelect = $("#startMinuteSelect");
const endHourSelect = $("#endHourSelect");
const endMinuteSelect = $("#endMinuteSelect");
const nameInput = $("#nameInput");
const noteInput = $("#noteInput");
const personInput = $("#personInput");
const totalRegistered = $("#totalRegistered");
const conflictBox = $("#conflictBox");
const syncStatus = $("#syncStatus");

initTimePickers();
setDefaultRange();
if (apiUrl) syncFromCloud();

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (!saved) return { registrations: [], people: [] };
  try {
    const parsed = JSON.parse(saved);
    return {
      registrations: collapseRegistrations(Array.isArray(parsed.registrations) ? parsed.registrations : []),
      people: Array.isArray(parsed.people) ? parsed.people : [],
    };
  } catch {
    return { registrations: [], people: [] };
  }
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function fillTimeSelect(select, max, step = 1) {
  if (!select || select.options.length) return;
  for (let value = 0; value <= max; value += step) {
    const option = document.createElement("option");
    option.value = pad2(value);
    option.textContent = pad2(value);
    select.appendChild(option);
  }
}

function syncSelectsFromInput(input, hourSelect, minuteSelect) {
  const normalized = normalizeTimeInput(input.value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return;
  if (hourSelect) hourSelect.value = match[1];
  if (minuteSelect) minuteSelect.value = match[1] === "24" ? "00" : match[2];
}

function setTimeInput(input, hourSelect, minuteSelect, value) {
  input.value = normalizeTimeInput(value);
  syncSelectsFromInput(input, hourSelect, minuteSelect);
}

function initTimePickers() {
  fillTimeSelect(startHourSelect, 23);
  fillTimeSelect(endHourSelect, 24);
  fillTimeSelect(startMinuteSelect, 59, 5);
  fillTimeSelect(endMinuteSelect, 59, 5);

  startHourSelect?.addEventListener("change", () => {
    startTimeInput.value = `${startHourSelect.value}:${startMinuteSelect.value || "00"}`;
    validateRange();
  });
  startMinuteSelect?.addEventListener("change", () => {
    startTimeInput.value = `${startHourSelect.value || "00"}:${startMinuteSelect.value}`;
    validateRange();
  });
  endHourSelect?.addEventListener("change", () => {
    if (endHourSelect.value === "24") {
      endMinuteSelect.value = "00";
      endTimeInput.dataset.endOfDay = "true";
      endTimeInput.value = "24:00";
    } else {
      endTimeInput.dataset.endOfDay = "false";
      endTimeInput.value = `${endHourSelect.value}:${endMinuteSelect.value || "00"}`;
    }
    validateRange();
  });
  endMinuteSelect?.addEventListener("change", () => {
    if (endHourSelect.value === "24") {
      endMinuteSelect.value = "00";
      endTimeInput.dataset.endOfDay = "true";
      endTimeInput.value = "24:00";
    } else {
      endTimeInput.dataset.endOfDay = "false";
      endTimeInput.value = `${endHourSelect.value || "00"}:${endMinuteSelect.value}`;
    }
    validateRange();
  });
}
function setDefaultRange() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  startDateInput.value = dateKey(now);
  endDateInput.value = dateKey(now);
  setTimeInput(startTimeInput, startHourSelect, startMinuteSelect, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  endTimeInput.dataset.endOfDay = "false";
  setTimeInput(endTimeInput, endHourSelect, endMinuteSelect, `${pad2(end.getHours())}:${pad2(end.getMinutes())}`);
}

function toDatetimeValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function dateKey(date) {
  return toDatetimeValue(date).slice(0, 10);
}

function parseScheduleDate(value) {
  if (value instanceof Date) return value;
  const text = String(value || "").trim();
  const raw = /^(ue|hu) /.test(text) ? `T${text}` : text;
  if (!raw) return new Date(NaN);
  const normalized = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/) ;
  if (normalized) {
    return new Date(Number(normalized[1]), Number(normalized[2]) - 1, Number(normalized[3]), Number(normalized[4]), Number(normalized[5]), 0, 0);
  }
  return new Date(raw);
}

function normalizeScheduleValue(value) {
  const date = parseScheduleDate(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return toDatetimeValue(date);
}

function normalizeRegistration(item) {
  return {
    ...item,
    start: normalizeScheduleValue(item.start),
    end: normalizeScheduleValue(item.end),
  };
}
function splitRegistrationByDay(item) {
  const normalized = normalizeRegistration(item);
  if (/(?:__\d{4}-\d{2}-\d{2})+$/.test(String(normalized.id || ""))) return [normalized];
  const dates = eachTouchedDate(normalized.start, normalized.end);
  if (dates.length <= 1) return [normalized];
  const originalStart = parseScheduleDate(normalized.start);
  const originalEnd = parseScheduleDate(normalized.end);
  return dates.map((dateValue) => {
    const dayStart = parseScheduleDate(`${dateValue}T00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const segmentStart = originalStart > dayStart ? originalStart : dayStart;
    const segmentEnd = originalEnd < dayEnd ? originalEnd : dayEnd;
    return { ...normalized, id: `${normalized.id}__${dateValue}`, start: toDatetimeValue(segmentStart), end: toDatetimeValue(segmentEnd) };
  });
}

function registrationRootId(id) {
  return String(id || "").replace(/(?:__\d{4}-\d{2}-\d{2})+$/, "");
}

function collapseRegistrations(items) {
  const groups = new Map();
  items.flatMap(splitRegistrationByDay).forEach(item => {
    const normalized = normalizeRegistration(item);
    const start = parseScheduleDate(normalized.start);
    const end = parseScheduleDate(normalized.end);
    const sourceId = String(normalized.id || "");
    const name = String(normalized.name || "").trim();
    if (!sourceId || !name || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return;
    const root = registrationRootId(sourceId);
    const day = dateKey(start);
    const key = `${root}|${day}`;
    const group = groups.get(key) || { root, day, name, note: "", start, end, sourceIds: new Set(), daily: false };
    if (start < group.start) group.start = start;
    if (end > group.end) group.end = end;
    if (!group.note && normalized.note) group.note = String(normalized.note);
    group.sourceIds.add(sourceId);
    group.daily ||= root !== sourceId;
    groups.set(key, group);
  });
  return [...groups.values()].map(group => ({
    id: group.daily ? `${group.root}__${group.day}` : [...group.sourceIds][0],
    name: group.name,
    start: toDatetimeValue(group.start),
    end: toDatetimeValue(group.end),
    note: group.note,
    sourceIds: [...group.sourceIds],
  })).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name));
}

function formatDateTime(value) {
  const date = parseScheduleDate(value);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateWithLunar(value) {
  const [year, month, day] = value.split("-").map(Number);
  const meta = getLunarMeta(year, month, day);
  const lunar = lunarLabel(meta);
  return `${pad2(day)}/${pad2(month)}/${year}${lunar ? ` (${lunar})` : ""}`;
}

function getMonthKey(date = visibleDate) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function eachTouchedDate(start, end) {
  const result = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const lastInstant = new Date(new Date(end).getTime() - 1);
  const last = new Date(lastInstant);
  last.setHours(0, 0, 0, 0);
  while (cursor <= last) {
    result.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function registrationsInMonth() {
  const key = getMonthKey();
  return state.registrations.filter((item) => eachTouchedDate(item.start, item.end).some((day) => day.startsWith(key)));
}

function registrationsByDate() {
  return registrationsInMonth().reduce((map, item) => {
    eachTouchedDate(item.start, item.end).forEach((day) => {
      map[day] = map[day] || [];
      map[day].push(item);
    });
    return map;
  }, {});
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function findConflicts(start, end, excludeId = "") {
  return state.registrations.filter((item) => item.id !== excludeId && rangesOverlap(start, end, item.start, item.end));
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function setStatus(message, type = "") {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.className = `hint ${type}`.trim();
}

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) || value === "24:00";
}

function normalizeTimeInput(value) {
  const trimmed = String(value || "").trim();
  if (/^\d{3,4}$/.test(trimmed)) {
    const padded = trimmed.padStart(4, "0");
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  const loose = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!loose) return trimmed;
  return `${pad2(Number(loose[1]))}:${pad2(Number(loose[2]))}`;
}

function buildDateTime(dateValue, timeValue) {
  timeValue = normalizeTimeInput(timeValue);
  if (!dateValue || !timeValue || !isValidTimeValue(timeValue)) return "";
  if (timeValue === "24:00") {
    const nextDay = new Date(`${dateValue}T00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    return `${dateKey(nextDay)}T00:00`;
  }
  return `${dateValue}T${timeValue}`;
}

function currentStartValue() {
  return buildDateTime(startDateInput.value, startTimeInput.value);
}

function currentEndValue() {
  return buildDateTime(endDateInput.value, endTimeInput.dataset.endOfDay === "true" || normalizeTimeInput(endTimeInput.value) === "24:00" ? "24:00" : endTimeInput.value);
}

function validateRange() {
  conflictBox.innerHTML = "";
  const start = currentStartValue();
  const end = currentEndValue();
  if (!start || !end) {
    conflictBox.className = "notice bad";
    conflictBox.textContent = "Giờ phải đúng dạng 00:00–24:00.";
    return false;
  }
  if (new Date(end) <= new Date(start)) {
    conflictBox.className = "notice bad";
    conflictBox.textContent = "Giờ kết thúc phải sau giờ bắt đầu.";
    return false;
  }
  const conflicts = findConflicts(start, end);
  if (conflicts.length) {
    conflictBox.className = "notice warn";
    conflictBox.textContent = `Trùng với: ${conflicts.map((item) => item.name).join(", ")}. Vẫn có thể lưu nếu chấp nhận.`;
  } else {
    conflictBox.className = "notice good";
    conflictBox.textContent = "Khung giờ này chưa trùng ai.";
  }
  return true;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDate(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function solarKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function intPart(value) {
  return Math.floor(value);
}

function jdFromDate(day, month, year) {
  const a = intPart((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  let jd = day + intPart((153 * m + 2) / 5) + 365 * y + intPart(y / 4) - intPart(y / 100) + intPart(y / 400) - 32045;
  if (jd < 2299161) jd = day + intPart((153 * m + 2) / 5) + 365 * y + intPart(y / 4) - 32083;
  return jd;
}

function jdToDate(jd) {
  let a;
  if (jd > 2299160) {
    const alpha = intPart((jd - 1867216.25) / 36524.25);
    a = jd + 1 + alpha - intPart(alpha / 4);
  } else {
    a = jd;
  }
  const b = a + 1524;
  const c = intPart((b - 122.1) / 365.25);
  const d = intPart(365.25 * c);
  const e = intPart((b - d) / 30.6001);
  const day = b - d - intPart(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month < 3 ? c - 4715 : c - 4716;
  return { day, month, year };
}

function getNewMoonDay(k, timeZone) {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const dr = Math.PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 = (0.1734 - 0.000393 * t) * Math.sin(m * dr) + 0.0021 * Math.sin(2 * dr * m);
  c1 -= 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(2 * dr * mpr);
  c1 -= 0.0004 * Math.sin(3 * dr * mpr);
  c1 += 0.0104 * Math.sin(2 * dr * f) - 0.0051 * Math.sin((m + mpr) * dr);
  c1 -= 0.0074 * Math.sin((m - mpr) * dr) + 0.0004 * Math.sin((2 * f + m) * dr);
  c1 -= 0.0004 * Math.sin((2 * f - m) * dr) - 0.0006 * Math.sin((2 * f + mpr) * dr);
  c1 += 0.001 * Math.sin((2 * f - mpr) * dr) + 0.0005 * Math.sin((2 * mpr + m) * dr);
  const deltaT = t < -11 ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3 : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return intPart(jd1 + c1 - deltaT + 0.5 + timeZone / 24);
}

function getSunLongitude(dayNumber, timeZone) {
  const t = (dayNumber - 2451545.5 - timeZone / 24) / 36525;
  const t2 = t * t;
  const dr = Math.PI / 180;
  const m = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  let dl = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * m);
  dl += (0.019993 - 0.000101 * t) * Math.sin(2 * dr * m) + 0.00029 * Math.sin(3 * dr * m);
  let l = l0 + dl;
  l *= dr;
  l -= Math.PI * 2 * intPart(l / (Math.PI * 2));
  return intPart(l / Math.PI * 6);
}

function getLunarMonth11(year, timeZone) {
  const off = jdFromDate(31, 12, year) - 2415021;
  const k = intPart(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  if (getSunLongitude(nm, timeZone) >= 9) nm = getNewMoonDay(k - 1, timeZone);
  return nm;
}

function getLeapMonthOffset(a11, timeZone) {
  const k = intPart((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i += 1;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

function convertSolarToLunar(day, month, year, timeZone = 7) {
  const dayNumber = jdFromDate(day, month, year);
  const k = intPart((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, timeZone);
  let a11 = getLunarMonth11(year, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = year;
    a11 = getLunarMonth11(year - 1, timeZone);
  } else {
    lunarYear = year + 1;
    b11 = getLunarMonth11(year + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = intPart((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

const buddhistLunarEvents = {
  "1-1": ["Ngày vía Đức Di Lặc"],
  "1-15": ["Ngày Lễ Thượng Nguyên"],
  "2-8": ["Ngày Phật Thích Ca xuất gia"],
  "2-15": ["Ngày Phật Thích Ca nhập Niết Bàn"],
  "2-19": ["Ngày vía Quan Thế Âm giáng sanh"],
  "2-21": ["Ngày vía Phổ Hiền giáng sanh"],
  "3-6": ["Ngày vía Ca Diếp Tôn Giả"],
  "3-16": ["Ngày Phật Mẫu Chuẩn Đề"],
  "4-4": ["Ngày vía Văn Thù Bồ Tát"],
  "4-8": ["Ngày vía Phật Thích Ca Đản Sanh"],
  "4-15": ["Rằm tháng Tư", "Vesak"],
  "4-20": ["Ngày vía Bồ Tát Quảng Đức vị pháp thiêu thân"],
  "4-23": ["Ngày vía Phổ Hiền Thành Đạo"],
  "4-28": ["Ngày vía Dược Sư Đản Sanh"],
  "5-13": ["Ngày vía Già Lam Thánh Chúng"],
  "6-3": ["Ngày vía Hộ Pháp"],
  "6-19": ["Ngày vía Quan Thế Âm Thành Đạo"],
  "7-13": ["Ngày vía Đại Thế Chí"],
  "7-15": ["Ngày Vu Lan Bồn", "Đại Hiếu Mục Kiền Liên Bồ Tát"],
  "7-30": ["Ngày vía Địa Tạng Bồ Tát"],
  "8-6": ["Ngày Huệ Viễn Tuệ Sư Sơ Tổ Tịnh Độ Tông"],
  "8-8": ["Ngày vía Tôn Giả A Nan Đà"],
  "9-19": ["Ngày vía Quan Thế Âm xuất gia"],
  "9-29": ["Ngày vía Dược Sư thành đạo"],
  "10-5": ["Ngày vía Đạt Ma Tổ Sư"],
  "10-8": ["Ngày Phóng sanh"],
  "10-15": ["Ngày lễ Hạ Nguyên"],
  "11-17": ["Ngày vía Phật A Di Đà"],
  "12-8": ["Ngày vía Phật Thích Ca Thành Đạo"],
  "12-23": ["Ngày vía Giám Trai Bồ Tát"],
  "12-29": ["Ngày vía Hoa Nghiêm Bồ Tát"],
};

const solarAnnualEvents = {
  "07-27": ["Sinh nhật Đại sư huynh"],
  "10-29": ["Sinh nhật Sư phụ"],
};

const vajrayanaMonthlyEvents = {
  1: "KCT: Phật A Súc Bệ",
  8: "KCT: Phật Dược Sư",
  10: "KCT: Phật Liên Hoa Sanh",
  14: "KCT: Chư Phật khắp mười phương",
  15: "KCT: Phật A Di Đà",
  18: "KCT: Phật Quan Âm",
  23: "KCT: Phật Tỳ Lô Giá Na",
  24: "KCT: Địa Tạng Vương Bồ Tát",
  25: "KCT: Dakini",
  28: "KCT: Ngũ Trí Phật Như Lai",
  29: "KCT: Kim cương Hộ pháp",
  30: "KCT: Phật Thích Ca Mâu Ni",
};

function getLunarMeta(year, month, day) {
  try {
    const lunar = convertSolarToLunar(day, month, year, 7);
    const key = `${lunar.month}-${lunar.day}`;
    const events = [...(solarAnnualEvents[`${pad2(month)}-${pad2(day)}`] || []), ...(buddhistLunarEvents[key] || [])];
    if (lunar.day === 1 && !events.some((event) => event.includes("Mùng 1") || event.includes("Tết"))) events.unshift(`Mùng 1 tháng ${lunar.month}`);
    if (lunar.day === 15 && !events.some((event) => event.includes("Rằm"))) events.unshift(`Rằm tháng ${lunar.month}`);
    if (vajrayanaMonthlyEvents[lunar.day]) events.push(vajrayanaMonthlyEvents[lunar.day]);
    return { lunar, events };
  } catch (error) {
    return { lunar: { day: 0, month: 0, year: 0, leap: 0 }, events: [] };
  }
}

function lunarLabel(meta) {
  if (!meta?.lunar?.day || !meta?.lunar?.month) return "";
  const leap = meta.lunar.leap ? " nhuận" : "";
  return `ÂL ${meta.lunar.day}/${meta.lunar.month}${leap}`;
}

function renderCalendar() {
  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  monthLabel.textContent = `Tháng ${month + 1}/${year}`;
  calendar.innerHTML = "";

  const firstDay = localDate(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const grouped = registrationsByDate();
  const todayValue = dateKey(new Date());

  for (let index = 0; index < offset; index += 1) {
    const blank = document.createElement("div");
    blank.className = "day blank";
    calendar.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = solarKey(year, month + 1, day);
    const items = grouped[value] || [];
    const meta = getLunarMeta(year, month + 1, day);
    const eventText = meta.events.slice(0, 2).join(" · ");
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day";
    if (value === todayValue) cell.classList.add("today");
    if (value === selectedDetailDate && dayOverlay?.classList.contains("show")) cell.classList.add("selected");
    if (items.length >= maxPerDay) cell.classList.add("full");
    if (items.length > 0 && items.length < maxPerDay) cell.classList.add("good");
    if (meta.events.length) cell.classList.add("holy-day");
    if (meta.lunar.day === 1 || meta.lunar.day === 15) cell.classList.add("lunar-focus");
    cell.title = meta.events.length ? meta.events.join("; ") : lunarLabel(meta);
    cell.innerHTML = `
      <span class="day-top"><span class="day-number">${day}</span><span class="lunar-date">${lunarLabel(meta)}</span></span>
      ${eventText ? `<span class="lunar-events">${eventText}</span>` : ""}
      <span class="names">${items.slice(0, 3).map((item) => item.name).join("<br>")}${items.length > 3 ? "<br>..." : ""}</span>
      <span class="day-count">${items.length} lượt</span>
    `;
    cell.addEventListener("click", () => {
      if (selectedDetailDate === value && dayOverlay?.classList.contains("show")) {
        closeDayDetail();
        return;
      }
      selectedDetailDate = value;
      renderDayDetail();
      openDayDetail();
    });
    calendar.appendChild(cell);
  }
}

function duplicateDayKey(item) {
  return `${item.name.trim().toLowerCase()}|${dateKey(parseScheduleDate(item.start))}`;
}

function duplicateIdsForItem(item) {
  const key = duplicateDayKey(item);
  const same = state.registrations
    .filter((registration) => registration.id !== item.id && duplicateDayKey(registration) === key && rangesOverlap(item.start, item.end, registration.start, registration.end))
    .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  return same.map((registration) => registration.id);
}

async function deleteDuplicateRegistrations(item) {
  const ids = duplicateIdsForItem(item);
  if (!ids.length) return;
  if (!confirm(`Xóa ${ids.length} lịch trùng của ${item.name} trong ngày này? App sẽ giữ lại bản mới nhất.`)) return;
  const beforeDelete = state.registrations;
  state.registrations = state.registrations.filter((registration) => !ids.includes(registration.id));
  saveState();
  render();
  const cloudIds = beforeDelete.filter(registration => ids.includes(registration.id)).flatMap(registration => registration.sourceIds?.length ? registration.sourceIds : [registration.id]);
  const ok = await pushToCloud({ action: "delMany", ids: cloudIds, people: state.people }, false);
  if (!ok) {
    state.registrations = beforeDelete;
    saveState();
    render();
    alert("Chưa xóa được trên Sheet, app đã khôi phục dữ liệu.");
  }
}
function renderLists() {
  totalRegistered.textContent = String(new Set(registrationsInMonth().map(item => registrationRootId(item.id))).size);
}

function renderTips() {}

function openDayDetail() {
  if (!dayOverlay) return;
  dayOverlay.classList.add("show");
  dayOverlay.setAttribute("aria-hidden", "false");
}

function closeDayDetail() {
  if (!dayOverlay) return;
  dayOverlay.classList.remove("show");
  dayOverlay.setAttribute("aria-hidden", "true");
  selectedDetailDate = "";
  renderCalendar();
}

function renderDayDetail() {
  if (!dayDetail || !selectedDetailDate) return;
  const [year, month, day] = selectedDetailDate.split("-").map(Number);
  const meta = getLunarMeta(year, month, day);
  const grouped = registrationsByDate();
  const items = (grouped[selectedDetailDate] || []).sort((a, b) => a.start.localeCompare(b.start));
  const status = dayStatus(selectedDetailDate, items);
  const events = meta.events.length ? `<p class="detail-events">${meta.events.join(" · ")}</p>` : '<p class="muted">Không có ngày lễ/vía đặc biệt.</p>';
  const schedules = items.length
    ? items.map((item) => `<li><strong>${item.name}</strong><span>${segmentTimeRange(item, selectedDetailDate)}${item.note ? ` · ${item.note}` : ""}</span></li>`).join("")
    : '<li><span class="muted">Chưa có ai đăng ký ngày này.</span></li>';

  dayDetail.innerHTML = `
    <div class="section-head compact">
      <div>
        <h3>Chi tiết ngày ${formatDate(selectedDetailDate)}</h3>
        <p class="hint">${lunarLabel(meta)}</p>
      </div>
      <div class="modal-actions"><span class="badge ${status.cls}">${status.label}</span><button class="modal-close" type="button" aria-label="Đóng">×</button></div>
    </div>
    ${events}
    <ul class="detail-list">${schedules}</ul>
  `;
}
function render() {
  renderCalendar();
  renderLists();
  renderTips();
  renderDayDetail();
}

async function syncFromCloud() {
  if (!apiUrl) return;
  try {
    setStatus("Đang tải dữ liệu online...");
    const beforeSync = JSON.stringify(state);
    localStorage.setItem(`${storeKey}-backup`, beforeSync);

    const response = await fetch(apiUrl);
    const data = await response.json();
    if (data.ok === false) throw new Error(data.error || "Apps Script trả lỗi.");
    const rawCloud = Array.isArray(data.registrations) ? data.registrations : Array.isArray(data) ? data : [];
    const cloudRegistrations = collapseRegistrations(rawCloud);
    const cloudPeople = Array.isArray(data.people) ? data.people : [];

    if (!cloudRegistrations.length && state.registrations.length) {
      setStatus("Dữ liệu online trống, giữ dữ liệu trên máy.", "warn");
      return;
    }

    state.registrations = cloudRegistrations;
    state.people = [...new Set([...state.people, ...cloudPeople].filter(Boolean))];
    saveState();
    render();
    setStatus("Đã đồng bộ online an toàn.", "good");
  } catch (error) {
    setStatus("Không tải được online. Đang dùng dữ liệu trên máy.", "bad");
  }
}

async function pushToCloud(payload, syncAfter = true) {
  if (!apiUrl) return true;
  try {
    setStatus("Đang gửi lên Sheet...");
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "Apps Script trả lỗi.");
    if ((payload.action === "del" || payload.action === "delMany") && typeof data.deleted !== "number") throw new Error("Apps Script chưa deploy bản xóa mới.");
    if (payload.action === "addMany" && typeof data.added !== "number") throw new Error("Apps Script chưa deploy bản ghi theo ngày.");
    if (payload.action === "splitMany" && typeof data.migrated !== "number") throw new Error("Apps Script chưa deploy bản ghi theo ngày.");
    const message = payload.action === "del" || payload.action === "delMany" ? `Đã xóa ${data.deleted} dòng trên Sheet.`
      : payload.action === "splitMany" ? `Đã tách ${data.migrated} lịch cũ theo ngày.`
      : payload.action === "addMany" ? `Đã lưu ${data.added} ngày lên Sheet.`
      : "Đã đồng bộ Sheet.";
    setStatus(message, "good");
    if (syncAfter) setTimeout(() => syncFromCloud(), 1200);
    return true;
  } catch (error) {
    console.error(error);
    alert(`Không gửi được lên Sheet: ${error.message}`);
    setStatus(`Lỗi gửi Sheet: ${error.message}`, "bad");
    return false;
  }
}
async function addRegistrations(items) {
  const normalizedItems = items.map(normalizeRegistration);
  const beforeAdd = state.registrations;
  state.registrations = state.registrations.concat(normalizedItems);
  const name = normalizedItems[0]?.name || "";
  if (name && !state.people.some((person) => person.toLowerCase() === name.toLowerCase())) state.people.push(name);
  saveState();
  render();
  const ok = await pushToCloud({ action: "addMany", items: normalizedItems, people: state.people }, false);
  if (!ok) {
    state.registrations = beforeAdd;
    saveState();
    render();
    alert("Chưa lưu được Sheet, app đã khôi phục dữ liệu.");
  }
}

async function deleteRegistration(id) {
  if (!confirm("Xóa lịch này khỏi app và Sheet?")) return;
  const beforeDelete = state.registrations;
  state.registrations = state.registrations.filter((item) => item.id !== id);
  saveState();
  render();
  const item = beforeDelete.find(registration => registration.id === id);
  const ids = item?.sourceIds?.length ? item.sourceIds : [id];
  const ok = await pushToCloud({ action: "delMany", ids, people: state.people }, false);
  if (!ok) {
    state.registrations = beforeDelete;
    saveState();
    render();
    alert("Chưa xóa được trên Sheet, app đã khôi phục dữ liệu.");
  }
}
$("#prevMonth").addEventListener("click", () => {
  visibleDate.setMonth(visibleDate.getMonth() - 1);
  render();
});

$("#nextMonth").addEventListener("click", () => {
  visibleDate.setMonth(visibleDate.getMonth() + 1);
  render();
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = normalizeName(nameInput.value);
  const start = currentStartValue();
  const end = currentEndValue();
  const note = noteInput.value.trim();
  if (!name || !start || !end || !validateRange()) return;

  const duplicate = state.registrations.some((item) => item.name.toLowerCase() === name.toLowerCase() && rangesOverlap(start, end, item.start, item.end));
  if (duplicate && !confirm("Tên này đã có lịch chồng giờ. Vẫn lưu tiếp?")) return;

  visibleDate = new Date(start);
  visibleDate.setDate(1);
  await addRegistrations(splitRegistrationByDay({ id: crypto.randomUUID(), name, start, end, note }));
  nameInput.value = "";
  noteInput.value = "";
  validateRange();
});



startDateInput.addEventListener("change", () => {
  if (!endDateInput.value || endDateInput.value < startDateInput.value) endDateInput.value = startDateInput.value;
  validateRange();
});
endDateInput.addEventListener("change", validateRange);

$("#syncNow")?.addEventListener("click", syncFromCloud);

function dayStatus(date, items) {
  const hasConflict = items.some((item) => daySpecificConflicts(item, date).length);
  if (hasConflict) return { label: "Có trùng", cls: "bad" };
  if (items.length >= maxPerDay) return { label: "Đông", cls: "bad" };
  if (items.length === 0) return { label: "Trống", cls: "warn" };
  if (items.length <= 2) return { label: "Ít", cls: "good" };
  return { label: "Ổn", cls: "good" };
}

function timeOnly(value) {
  const date = parseScheduleDate(value);
  if (date.getHours() === 0 && date.getMinutes() === 0 && value.endsWith("T00:00")) return "24:00";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}


function dayBounds(dateValue) {
  const start = new Date(`${dateValue}T00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function daySegmentForItem(item, dateValue) {
  const bounds = dayBounds(dateValue);
  const itemStart = parseScheduleDate(item.start);
  const itemEnd = parseScheduleDate(item.end);
  const segmentStart = itemStart > bounds.start ? itemStart : bounds.start;
  const segmentEnd = itemEnd < bounds.end ? itemEnd : bounds.end;
  if (segmentStart >= segmentEnd) return null;
  return { start: segmentStart, end: segmentEnd };
}

function segmentTimeRange(item, dateValue) {
  const segment = daySegmentForItem(item, dateValue);
  if (!segment) return "";
  const start = segment.start.getTime() === dayBounds(dateValue).start.getTime() ? "00:00" : `${pad2(segment.start.getHours())}:${pad2(segment.start.getMinutes())}`;
  const end = segment.end.getTime() === dayBounds(dateValue).end.getTime() ? "24:00" : `${pad2(segment.end.getHours())}:${pad2(segment.end.getMinutes())}`;
  return `${start} → ${end}`;
}

function daySpecificConflicts(item, dateValue) {
  const current = daySegmentForItem(item, dateValue);
  if (!current) return [];
  return (registrationsByDate()[dateValue] || []).filter((other) => {
    if (other.id === item.id) return false;
    const otherSegment = daySegmentForItem(other, dateValue);
    return otherSegment && current.start < otherSegment.end && otherSegment.start < current.end;
  });
}
function weekLabelForMonthDay(year, monthIndex, day) {
  const date = localDate(year, monthIndex, day);
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const monthStart = localDate(year, monthIndex, 1);
  const weekNumber = Math.floor((day + ((monthStart.getDay() + 6) % 7) - 1) / 7) + 1;
  return `Tuần ${weekNumber}: ${formatDate(dateKey(start))} - ${formatDate(dateKey(end))}`;
}
function renderDayMiniTable(items, value) {
  if (!items.length) return '<span class="weekly-empty">Chưa có người đăng ký</span>';
  const groups = new Map();
  items.forEach((item) => {
    const key = item.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: item.name, items: [] });
    groups.get(key).items.push(item);
  });

  return [...groups.values()].map((group) => {
    const notes = [...new Set(group.items.map((item) => item.note).filter(Boolean))];
    const slots = group.items.map((item) => {
      const duplicateIds = duplicateIdsForItem(item);
      return `<div class="time-chip"><span class="slot-time">${segmentTimeRange(item, value)}</span>${duplicateIds.length ? `<button class="dedupe" type="button" data-id="${item.id}">Xóa trùng</button>` : ""}<button class="delete-one" type="button" data-id="${item.id}">Xóa</button></div>`;
    }).join("");
    return `<div class="weekly-person-row"><div class="weekly-person-info"><strong>${group.name}</strong>${notes.length ? `<small>${notes.join(" · ")}</small>` : ""}</div><div class="slots-cell">${slots}</div></div>`;
  }).join("");
}

function renderDailyOverview() {
  const overview = document.querySelector("#dailyOverview");
  if (!overview) return;
  const grouped = registrationsByDate();
  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const label = weekLabelForMonthDay(year, month, day);
    let week = weeks.find((item) => item.label === label);
    if (!week) {
      week = { label, total: 0, days: [] };
      weeks.push(week);
    }

    const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const items = (grouped[value] || []).sort((a, b) => a.start.localeCompare(b.start));
    const meta = getLunarMeta(year, month + 1, day);
    week.total += items.length;
    week.days.push({
      date: value,
      items,
      meta,
      weekday: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"][(localDate(year, month, day).getDay() + 6) % 7],
      schedules: renderDayMiniTable(items, value),
    });
  }

  overview.innerHTML = weeks.map((week, index) => {
    const [title, range = ""] = week.label.split(": ");
    const days = week.days.map((day) => {
      const events = day.meta.events.join(" · ");
      const busy = day.items.length >= maxPerDay ? " busy" : "";
      return `<section class="week-day-block${busy}"><div class="week-day-title"><div><strong>${day.weekday} · ${formatDate(day.date)}</strong><span>${lunarLabel(day.meta)}${day.items.length ? ` · ${day.items.length} lượt` : ""}</span></div>${events ? `<p>${events}</p>` : ""}</div><div class="week-day-schedules">${day.schedules}</div></section>`;
    }).join("");
    return `<article class="week-card${index % 2 ? " alternate" : ""}"><header class="week-card-header"><div><h4>${title}</h4><small>${range.replace(" - ", "–")}</small></div><span>${week.total} lượt</span></header>${days}</article>`;
  }).join("");

  overview.onclick = (event) => {
    const deleteButton = event.target.closest(".delete-one");
    if (deleteButton) return deleteRegistration(deleteButton.dataset.id);
    const dedupeButton = event.target.closest(".dedupe");
    if (dedupeButton) {
      const item = state.registrations.find((registration) => registration.id === dedupeButton.dataset.id);
      if (item) deleteDuplicateRegistrations(item);
    }
  };
}

function buildZaloText() {
  const grouped = registrationsByDate();
  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lines = [`LỊCH THĂM SƯ PHỤ - THÁNG ${month + 1}/${year}`, ""];
  const busyDays = [];
  const conflictDays = [];

  let lastWeekLabel = "";
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekLabel = weekLabelForMonthDay(year, month, day);
    if (weekLabel !== lastWeekLabel) {
      table.insertAdjacentHTML("beforeend", `<div class="overview-week-row">${weekLabel}</div>`);
      lastWeekLabel = weekLabel;
    }
    const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const items = (grouped[value] || []).sort((a, b) => a.start.localeCompare(b.start));
    if (!items.length) continue;
    const hasConflict = items.some((item) => daySpecificConflicts(item, selectedDetailDate).length);
    if (items.length >= maxPerDay) busyDays.push(formatDate(value));
    if (hasConflict) conflictDays.push(formatDate(value));
    lines.push(`${formatDate(value)}: ${items.length} lượt${items.length >= maxPerDay ? " - ĐÔNG" : ""}${hasConflict ? " - CÓ TRÙNG" : ""}`);
    items.forEach((item) => lines.push(`- ${item.name}: ${segmentTimeRange(item, value)}${item.note ? ` (${item.note})` : ""}`));
    lines.push("");
  }

  if (busyDays.length || conflictDays.length) {
    lines.push("Lưu ý:");
    if (busyDays.length) lines.push(`- Ngày đông: ${busyDays.join(", ")}`);
    if (conflictDays.length) lines.push(`- Lịch bị trùng: ${conflictDays.join(", ")}`);
  }

  return lines.join("\n").trim();
}

async function copyZaloText() {
  const text = buildZaloText();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  alert("Đã copy tin nhắn Zalo.");
}

const oldRender = render;
render = function renderAll() {
  oldRender();
  renderDailyOverview();
};


async function forcePushLocalToCloud() {
  if (!confirm("Đẩy toàn bộ dữ liệu hiện đang thấy trên app lên Sheet? Chỉ dùng khi Sheet bị thiếu dữ liệu.")) return;
  const ok = await pushToCloud({ action: "overwriteAll", registrations: state.registrations, people: state.people });
  if (ok) alert("Đã gửi lệnh đẩy dữ liệu lên Sheet. Đợi vài giây rồi kiểm tra tab Registrations.");
}
if (new URLSearchParams(location.search).get("admin") === "1") {
  document.querySelector("#copyZalo")?.addEventListener("click", copyZaloText);
  const adminPanel = document.createElement("div");
  adminPanel.className = "card admin-panel";
  adminPanel.innerHTML = `<h3>Admin đồng bộ</h3><p class="hint">Dùng khi app và Sheet bị lệch dữ liệu.</p><div class="button-row"><button id="forcePushCloud" type="button">Đẩy app lên Sheet</button><button id="reloadCloud" class="ghost" type="button">Tải lại từ Sheet</button></div>`;
  document.querySelector(".app-shell")?.appendChild(adminPanel);
  document.querySelector("#forcePushCloud")?.addEventListener("click", forcePushLocalToCloud);
  document.querySelector("#reloadCloud")?.addEventListener("click", syncFromCloud);
}
dayOverlay?.addEventListener("click", (event) => {
  if (event.target === dayOverlay) closeDayDetail();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDayDetail();
});
dayDetail?.addEventListener("click", (event) => {
  if (event.target.closest(".modal-close")) closeDayDetail();
});

render();























