/* ============================================================
   EON Brain — schema auto-discovery for a Firestore data doc.
   Your data is one document holding arrays of records per entity
   (opportunities, tasks, …). EON discovers each entity's fields,
   detects the date/deadline field and a human label — no manual
   list. This is the Firestore "adapter" equivalent of the SQL
   schema discovery.
   ============================================================ */

const DEADLINE_HINTS = [
  'deadline', 'duedate', 'due', 'expiry', 'expirydate', 'expire', 'expires',
  'valid_till', 'validtill', 'valid_until', 'renewal', 'renew', 'enddate',
  'eventdate', 'end', 'closedate', 'targetdate', 'remind_at', 'remindat', 'date',
];
const LABEL_HINTS   = ['name', 'title', 'label', 'subject', 'reference', 'ref', 'code'];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does this value look like a date/datetime? */
function looksLikeDate(v) {
  if (v == null) return false;
  if (typeof v === 'object' && typeof v.seconds === 'number') return true; // Firestore Timestamp
  if (typeof v !== 'string') return false;
  if (!/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

/** ISO-8601 from a source value (string / Firestore Timestamp). */
export function toIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Discover entities from the data doc.
 * @returns {Object<string,{idField,labelField,deadlineField,dateFields:string[],fields:string[]}>}
 */
export function discover(data, overrides = {}, deadlineEntities = null) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (key.startsWith('_')) continue;          // system arrays (e.g. _events) are not entities
    if (!Array.isArray(value) || value.length === 0) continue;
    const sample = value.filter((x) => x && typeof x === 'object').slice(0, 50);
    if (!sample.length) continue;

    const fields = [...new Set(sample.flatMap((r) => Object.keys(r)))];
    const idField = fields.includes('id') ? 'id' : fields[0];

    // date fields: by name hint OR by value sampling
    const dateFields = fields.filter((f) => {
      const n = norm(f);
      const byName = /date|deadline|due|expir|renew|validtill|validuntil|eventdate|_at$/.test(n);
      const byValue = sample.some((r) => looksLikeDate(r[f]));
      return byName || byValue;
    });

    const ov = overrides[key] || {};
    // Only some entities genuinely have a "deadline" (something you must act on
    // before a date). Achievements, projects, research, contacts, etc. carry
    // historical dates (award date, etc.) that must NOT be nagged as deadlines.
    // When `deadlineEntities` is supplied, any entity outside it has no deadline.
    // An explicit override of `deadlineField: false/null` also disables it.
    const allowed = !Array.isArray(deadlineEntities) || deadlineEntities.includes(key);
    let deadlineField;
    if ('deadlineField' in ov) deadlineField = ov.deadlineField || null;
    else if (!allowed) deadlineField = null;
    else deadlineField = pickByHints(dateFields, DEADLINE_HINTS) || dateFields[0] || null;
    const labelField = ov.labelField || pickByHints(fields, LABEL_HINTS) || null;

    out[key] = { idField, labelField, deadlineField, dateFields, fields };
  }
  return out;
}

/** Flatten one entity's records into normalized memory rows. */
export function extractRecords(data, entity, desc) {
  const rows = [];
  const list = Array.isArray(data?.[entity]) ? data[entity] : [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r[desc.idField] ?? '');
    if (id === '') continue;
    const deadlineAt = desc.deadlineField ? toIso(r[desc.deadlineField]) : null;
    const label = (desc.labelField && r[desc.labelField]) ? String(r[desc.labelField]) : `${entity} #${id}`;
    rows.push({ entity, id, label, deadlineAt, payload: r });
  }
  return rows;
}

function pickByHints(fields, hints) {
  for (const hint of hints) {
    const hit = fields.find((f) => norm(f).includes(hint.replace(/_/g, '')));
    if (hit) return hit;
  }
  return null;
}
