const SHEET_REG = "Registrations";
const SHEET_PEOPLE = "People";
const SHEET_DELETED = "Deleted";
const DELETED_HEADERS = ["deletedAt", "action", "id", "name", "start", "end", "note", "restore", "restoredAt"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("L\u1ecbch th\u0103m").addItem("Restore d\u00f2ng \u0111\u00e3 ch\u1ecdn", "restoreSelectedDeletedRows").addToUi();
}

function onEdit(e) {
  const sheet = e && e.range && e.range.getSheet();
  if (!sheet || sheet.getName() !== SHEET_DELETED || e.range.getColumn() !== 8 || e.value !== "TRUE") return;
  restoreDeletedRow_(sheet, e.range.getRow());
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
  const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
  const deleted = ss.getSheetByName(SHEET_DELETED) || ss.insertSheet(SHEET_DELETED);
  ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
  setRegistrationTextFormat_(reg);
  ensureHeaders_(people, ["name"]);
  ensureDeletedSheet_(deleted);
}

function doGet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
    const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
    const deleted = ss.getSheetByName(SHEET_DELETED) || ss.insertSheet(SHEET_DELETED);
    ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
    setRegistrationTextFormat_(reg);
    repairRegistrationSheet_(reg, deleted);
    ensureHeaders_(people, ["name"]);
    ensureDeletedSheet_(deleted);
    syncPeopleFromRegistrations_(reg, people);

    const registrations = reg.getDataRange().getValues().slice(1).filter(row => row[0]).map(row => ({
      id: String(row[0] || ""),
      name: String(row[1] || ""),
      start: String(row[2] || ""),
      end: String(row[3] || ""),
      note: String(row[4] || ""),
    }));
    const peopleList = people.getDataRange().getValues().slice(1).map(row => String(row[0] || "")).filter(Boolean);
    return json({ ok: true, version: "2026-07-16-collapse", registrations, people: peopleList });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
    const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
    const deleted = ss.getSheetByName(SHEET_DELETED) || ss.insertSheet(SHEET_DELETED);
    ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
    setRegistrationTextFormat_(reg);
    ensureHeaders_(people, ["name"]);
    ensureDeletedSheet_(deleted);
    let deletedCount = 0;
    let addedCount = 0;
    let migratedCount = 0;

    if (body.action === "add" && body.item) {
      const item = body.item;
      const ids = getIds_(reg);
      if (!ids.has(String(item.id))) {
        appendRegistration_(reg, item);
        addedCount = 1;
      }
      syncPeopleFromRegistrations_(reg, people);
    }


    if (body.action === "addMany" && Array.isArray(body.items)) {
      const ids = getIds_(reg);
      body.items.forEach(item => {
        const id = String(item.id || "");
        if (id && !ids.has(id)) {
          appendRegistration_(reg, item);
          ids.add(id);
          addedCount += 1;
        }
      });
      syncPeopleFromRegistrations_(reg, people);
    }

    if (body.action === "splitMany" && Array.isArray(body.replacements)) {
      const ids = getIds_(reg);
      body.replacements.forEach(replacement => {
        const oldId = String(replacement.id || "");
        if (!oldId || !ids.has(oldId) || !Array.isArray(replacement.items)) return;
        removeIds_(reg, [oldId]);
        ids.delete(oldId);
        replacement.items.forEach(item => {
          const id = String(item.id || "");
          if (id && !ids.has(id)) {
            appendRegistration_(reg, item);
            ids.add(id);
          }
        });
        migratedCount += 1;
      });
      syncPeopleFromRegistrations_(reg, people);
    }

    if (body.action === "del" && body.id) {
      deletedCount = deleteIds_(reg, [String(body.id)], deleted, "del");
      syncPeopleFromRegistrations_(reg, people);
    }

    if (body.action === "delMany" && Array.isArray(body.ids)) {
      deletedCount = deleteIds_(reg, body.ids.map(String), deleted, "delMany");
      syncPeopleFromRegistrations_(reg, people);
    }

    if (body.action === "overwriteAll" && Array.isArray(body.registrations)) {
      logDeletedRows_(deleted, reg.getDataRange().getValues().slice(1), "overwriteAll");
      reg.clear();
      reg.appendRow(["id", "name", "start", "end", "note"]);
      body.registrations.forEach(item => appendRegistration_(reg, item));
      syncPeopleFromRegistrations_(reg, people);
    }

    if (body.action === "people" && Array.isArray(body.people)) {
      rewritePeople_(people, body.people);
    }

    repairRegistrationSheet_(reg, deleted);
    SpreadsheetApp.flush();
    return json({ ok: true, deleted: deletedCount, added: addedCount, migrated: migratedCount, version: "2026-07-16-collapse" });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function restoreSelectedDeletedRows() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_DELETED) throw new Error("Select rows in Deleted first.");
  const range = sheet.getActiveRange();
  for (let row = range.getRow(); row < range.getRow() + range.getNumRows(); row += 1) restoreDeletedRow_(sheet, row);
}

function restoreDeletedRow_(deleted, rowNumber) {
  if (rowNumber <= 1) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
  const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
  ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
  setRegistrationTextFormat_(reg);
  ensureHeaders_(people, ["name"]);
  const row = deleted.getRange(rowNumber, 1, 1, DELETED_HEADERS.length).getValues()[0];
  const item = { id: row[2], name: row[3], start: row[4], end: row[5], note: row[6] };
  if (item.id && !getIds_(reg).has(String(item.id))) appendRegistration_(reg, item);
  deleted.getRange(rowNumber, 8, 1, 2).setValues([[false, new Date()]]);
  repairRegistrationSheet_(reg, deleted);
  syncPeopleFromRegistrations_(reg, people);
}

function normalizeSchedule_(value) {
  return String(value || "").trim().replace(/^(\d{4}-\d{2}-\d{2})T/, "$1 ");
}

function setRegistrationTextFormat_(sheet) {
  sheet.getRange("C:D").setNumberFormat("@");
}

function appendRegistration_(sheet, item) {
  const row = sheet.getLastRow() + 1;
  const range = sheet.getRange(row, 1, 1, 5);
  range.setNumberFormat("@");
  range.setValues([[String(item.id || ""), String(item.name || ""), normalizeSchedule_(item.start), normalizeSchedule_(item.end), String(item.note || "")]]);
}


function scheduleCellToText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm");
  }
  if (typeof value === "number" || /^\d+(?:[.,]\d+)?$/.test(String(value || "").trim())) {
    const serial = Number(String(value).replace(",", "."));
    if (Number.isFinite(serial) && serial > 20000) return Utilities.formatDate(new Date(Math.round((serial - 25569) * 86400000)), "UTC", "yyyy-MM-dd HH:mm");
  }
  const text = String(value || "").trim();
  const restored = /^(ue|hu) /.test(text) ? `T${text}` : text;
  const parsed = new Date(restored);
  if (!isNaN(parsed.getTime()) && !/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(restored)) {
    return Utilities.formatDate(parsed, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm");
  }
  return normalizeSchedule_(restored);
}

function repairRegistrationSheet_(sheet, deleted) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  const seen = new Set();
  const duplicateRows = [];
  const invalidRows = [];
  const sourceRows = [];
  let changed = false;
  values.slice(1).forEach(row => {
    const id = String(row[0] || "").trim();
    const normalized = [id, String(row[1] || ""), scheduleCellToText_(row[2]), scheduleCellToText_(row[3]), String(row[4] || "")];
    if (!id || !normalized[1].trim() || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized[2]) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized[3]) || normalized[2] >= normalized[3]) {
      changed = true;
      if (id) invalidRows.push(normalized);
      return;
    }
    if (seen.has(id)) {
      changed = true;
      duplicateRows.push(normalized);
      return;
    }
    seen.add(id);
    if (normalized.some((value, column) => String(row[column] ?? "") !== value)) changed = true;
    sourceRows.push(normalized);
  });

  const groups = new Map();
  sourceRows.forEach(row => {
    const root = row[0].replace(/(?:__\d{4}-\d{2}-\d{2})+$/, "");
    const daily = root !== row[0];
    const day = row[2].slice(0, 10);
    const key = `${root}|${day}`;
    const group = groups.get(key) || { root, day, daily, rows: [], name: row[1], start: row[2], end: row[3], note: row[4] };
    group.rows.push(row);
    if (row[2] < group.start) group.start = row[2];
    if (row[3] > group.end) group.end = row[3];
    if (!group.note && row[4]) group.note = row[4];
    group.daily ||= daily;
    groups.set(key, group);
  });

  const explodedRows = [];
  const rows = [...groups.values()].map(group => {
    const canonical = [group.daily ? `${group.root}__${group.day}` : group.rows[0][0], group.name, group.start, group.end, group.note];
    if (group.rows.length > 1 || group.rows.some(row => row.some((value, column) => value !== canonical[column]))) {
      changed = true;
      explodedRows.push(...group.rows);
    }
    return canonical;
  });
  rows.sort((a, b) => a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const needsRewrite = changed || !rows.every((row, index) => row[0] === String(values[index + 1][0] || ""));
  if (needsRewrite) {
    if (duplicateRows.length && deleted) logDeletedRows_(deleted, duplicateRows, "repairDuplicate");
    if (invalidRows.length && deleted) logDeletedRows_(deleted, invalidRows, "repairInvalid");
    if (explodedRows.length && deleted) logDeletedRows_(deleted, explodedRows, "repairExploded");
    sheet.getRange(1, 1, values.length, 5).clearContent();
    const output = [["id", "name", "start", "end", "note"]].concat(rows);
    const range = sheet.getRange(1, 1, output.length, 5);
    range.setNumberFormat("@");
    range.setValues(output);
  }
  formatRegistrationSheet_(sheet, rows);
}

function dayNumber_(value) {
  const parts = String(value || "").split("-").map(Number);
  return parts.length === 3 ? Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000 : NaN;
}

function formatRegistrationSheet_(sheet, rows) {
  if (!rows.length) return;
  const groups = new Map();
  const dataRange = sheet.getRange(2, 1, rows.length, 5);
  dataRange.setBackground("#ffffff").setFontColor("#111827").setFontWeight("normal");
  dataRange.setBorder(true, true, true, true, true, true, "#d1d5db", SpreadsheetApp.BorderStyle.SOLID);

  let dayStart = 0;
  rows.forEach((row, index) => {
    const id = String(row[0] || "");
    const group = id.replace(/__\d{4}-\d{2}-\d{2}$/, "");
    const day = String(row[2] || "").slice(0, 10);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ row: index + 2, day });
    if (index < rows.length - 1 && day === String(rows[index + 1][2] || "").slice(0, 10)) return;
    const dayRange = sheet.getRange(dayStart + 2, 1, index - dayStart + 1, 5);
    dayRange.setBackground(dayNumber_(day) % 2 ? "#f8fafc" : "#eef6ff");
    dayRange.setBorder(true, true, true, true, null, null, "#2563eb", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    dayStart = index + 1;
  });

  groups.forEach(entries => {
    const days = [...new Set(entries.map(entry => entry.day))].sort();
    const consecutive = days.length > 1 && days.every((day, index) => index === 0 || dayNumber_(day) === dayNumber_(days[index - 1]) + 1);
    if (consecutive) entries.forEach(entry => sheet.getRange(entry.row, 2).setBackground("#fef3c7").setFontColor("#92400e").setFontWeight("bold"));
  });
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const missing = headers.some((header, index) => String(current[index] || "") !== header);
  if (missing) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function getIds_(sheet) {
  return new Set(sheet.getDataRange().getValues().slice(1).map(row => String(row[0] || "")).filter(Boolean));
}

function removeIds_(sheet, ids) {
  const idSet = new Set(ids.map(String));
  const values = sheet.getDataRange().getValues();
  let removed = 0;
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (idSet.has(String(values[row][0]))) {
      sheet.deleteRow(row + 1);
      removed += 1;
    }
  }
  return removed;
}

function deleteIds_(sheet, ids, deleted, action) {
  const idSet = new Set(ids.map(String));
  const values = sheet.getDataRange().getValues();
  const matches = values.slice(1).filter(row => idSet.has(String(row[0])));
  logDeletedRows_(deleted, matches, action);
  removeIds_(sheet, ids);
  return matches.length;
}

function logDeletedRows_(sheet, rows, action) {
  const matches = rows.filter(row => row[0]);
  if (!matches.length) return 0;
  ensureDeletedSheet_(sheet);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, matches.length, DELETED_HEADERS.length).setValues(matches.map(row => [new Date(), action, row[0], row[1], scheduleCellToText_(row[2]), scheduleCellToText_(row[3]), row[4], false, ""]));
  sheet.getRange(startRow, 1, matches.length, 1).setNumberFormat("yyyy-MM-dd HH:mm:ss");
  sheet.getRange(startRow, 8, matches.length, 1).insertCheckboxes();
  return matches.length;
}

function ensureDeletedSheet_(sheet) {
  ensureHeaders_(sheet, DELETED_HEADERS);
  sheet.getRange("H2:H").insertCheckboxes();
}

function rewritePeople_(sheet, people) {
  sheet.clear();
  sheet.appendRow(["name"]);
  const unique = new Map();
  people.map(name => String(name || "").trim()).filter(Boolean).forEach(name => {
    const key = name.toLowerCase();
    if (!unique.has(key)) unique.set(key, name);
  });
  [...unique.values()].forEach(name => sheet.appendRow([name]));
}

function syncPeopleFromRegistrations_(reg, people) {
  const existing = people.getDataRange().getValues().slice(1).map(row => String(row[0] || "").trim()).filter(Boolean);
  const registered = reg.getDataRange().getValues().slice(1).map(row => String(row[1] || "").trim()).filter(Boolean);
  rewritePeople_(people, existing.concat(registered));
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
