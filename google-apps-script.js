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
    return json({ ok: true, version: "2026-07-13-daily", registrations, people: peopleList });
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
    repairRegistrationSheet_(reg, deleted);
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

    SpreadsheetApp.flush();
    return json({ ok: true, deleted: deletedCount, added: addedCount, migrated: migratedCount, version: "2026-07-13-daily" });
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
  syncPeopleFromRegistrations_(reg, people);
}

function normalizeSchedule_(value) {
  return String(value || "").replace("T", " ");
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
  return normalizeSchedule_(value);
}

function repairRegistrationSheet_(sheet, deleted) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  const seen = new Set();
  const groupOrder = new Map();
  const duplicateRows = [];
  const rows = [];
  let changed = false;
  values.slice(1).forEach((row, index) => {
    const id = String(row[0] || "").trim();
    const normalized = [id, String(row[1] || ""), scheduleCellToText_(row[2]), scheduleCellToText_(row[3]), String(row[4] || "")];
    if (!id || seen.has(id)) {
      changed = true;
      if (id) duplicateRows.push(normalized);
      return;
    }
    seen.add(id);
    const group = id.replace(/__\d{4}-\d{2}-\d{2}$/, "");
    if (!groupOrder.has(group)) groupOrder.set(group, index);
    if (normalized.some((value, column) => String(row[column] ?? "") !== value)) changed = true;
    rows.push({ group, values: normalized });
  });
  rows.sort((a, b) => groupOrder.get(a.group) - groupOrder.get(b.group) || a.values[2].localeCompare(b.values[2]));
  if (!changed && rows.every((row, index) => row.values[0] === String(values[index + 1][0] || ""))) return;
  if (duplicateRows.length && deleted) logDeletedRows_(deleted, duplicateRows, "repairDuplicate");
  sheet.getRange(1, 1, values.length, 5).clearContent();
  const output = [["id", "name", "start", "end", "note"]].concat(rows.map(row => row.values));
  const range = sheet.getRange(1, 1, output.length, 5);
  range.setNumberFormat("@");
  range.setValues(output);
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
  ensureDeletedSheet_(sheet);
  rows.filter(row => row[0]).forEach(row => sheet.appendRow([new Date(), action, row[0], row[1], row[2], row[3], row[4], false, ""]));
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
