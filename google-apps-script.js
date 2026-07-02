const SHEET_REG = "Registrations";
const SHEET_PEOPLE = "People";

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
  const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
  ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
  setRegistrationTextFormat_(reg);
  ensureHeaders_(people, ["name"]);
}

function doGet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
    const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
    ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
  setRegistrationTextFormat_(reg);
    ensureHeaders_(people, ["name"]);

    const registrations = reg.getDataRange().getValues().slice(1).filter(row => row[0]).map(row => ({
      id: String(row[0] || ""),
      name: String(row[1] || ""),
      start: String(row[2] || ""),
      end: String(row[3] || ""),
      note: String(row[4] || ""),
    }));
    const peopleList = people.getDataRange().getValues().slice(1).map(row => String(row[0] || "")).filter(Boolean);
    return json({ ok: true, registrations, people: peopleList });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reg = ss.getSheetByName(SHEET_REG) || ss.insertSheet(SHEET_REG);
    const people = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
    ensureHeaders_(reg, ["id", "name", "start", "end", "note"]);
  setRegistrationTextFormat_(reg);
    ensureHeaders_(people, ["name"]);

    if (body.action === "add" && body.item) {
      const item = body.item;
      const ids = getIds_(reg);
      if (!ids.has(String(item.id))) {
        appendRegistration_(reg, item);
      }
    }

    if (body.action === "del" && body.id) {
      deleteIds_(reg, [String(body.id)]);
    }

    if (body.action === "delMany" && Array.isArray(body.ids)) {
      deleteIds_(reg, body.ids.map(String));
    }

    if (body.action === "overwriteAll" && Array.isArray(body.registrations)) {
      reg.clear();
      reg.appendRow(["id", "name", "start", "end", "note"]);
      body.registrations.forEach(item => appendRegistration_(reg, item));
    }

    if (body.action === "people" && Array.isArray(body.people)) {
      rewritePeople_(people, body.people);
    }

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function normalizeSchedule_(value) {
  return String(value || "").replace("T", " ");
}

function setRegistrationTextFormat_(sheet) {
  sheet.getRange("C:D").setNumberFormat("@");
}

function appendRegistration_(sheet, item) {
  setRegistrationTextFormat_(sheet);
  sheet.appendRow([String(item.id || ""), String(item.name || ""), normalizeSchedule_(item.start), normalizeSchedule_(item.end), String(item.note || "")]);
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

function deleteIds_(sheet, ids) {
  const idSet = new Set(ids);
  const values = sheet.getDataRange().getValues();
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (idSet.has(String(values[row][0]))) sheet.deleteRow(row + 1);
  }
}

function rewritePeople_(sheet, people) {
  sheet.clear();
  sheet.appendRow(["name"]);
  [...new Set(people.map(name => String(name || "").trim()).filter(Boolean))].forEach(name => sheet.appendRow([name]));
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}


