// Fast CSV reader with the exact semantics of csv-reader 1.0.0.
// Written from scratch: instead of walking the text character by character,
// the scanner jumps from one delimiter to the next with indexOf / a single
// delimiter regex, slices whole fields at once, and splits quote-free
// records with String.split. Rare broken-row paths (stray CR, quote junk,
// unterminated quotes, quoted newlines) keep the reference's exact behaviour.
//
// Semantics (matching the reference exactly):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote; each CRLF or lone CR inside reads as LF; what
//   follows the closing quote up to the next comma or line break is appended
//   as it stands (error quote_junk when the field ends and anything was added);
//   a quote that never closes is a literal character and the text after it is
//   read again as unquoted (error unterminated_quote, recorded before the re-read).
// - A quote inside an unquoted field is a literal character. Fields stay
//   strings, never trimmed or converted.
// - columns is the first record when header is true, else null ([] when
//   header is true but there is no record at all); rows holds the records
//   after it, each padded with "" (short_row, with fields: its field count)
//   or cut (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row} in the order met; line is the 1-based line
//   its record starts on (counting every LF, CRLF and lone CR inside quotes),
//   row its record's index in rows (null for the header).

// The next delimiter of an unquoted field: comma, CR or LF (a quote inside
// an unquoted field is a literal character, never a delimiter).
const DELIM = /[,\r\n]/g;

// Reads an unquoted field starting at `pos`, with `value` already collected
// ("" normally, or the quoted value for quote junk, or '"' for the
// unterminated-quote re-read). Cold path: only used for quote junk and the
// unterminated-quote re-read. Returns [value, ended, pos, line, added] where
// ended is 0 = comma, 1 = line break, 2 = end of text, and added counts the
// characters kept during this call.
function readUnquoted(text, n, pos, line, recordLine, recordRow, errors, value) {
  let added = 0;
  let parts = null;
  let segStart = pos;
  for (;;) {
    DELIM.lastIndex = pos;
    const m = DELIM.exec(text);
    if (m === null) {
      const seg = text.slice(segStart, n);
      if (parts === null) value = value + seg;
      else { parts.push(seg); value = parts.join(""); }
      added += seg.length;
      return [value, 2, n, line, added];
    }
    const i = m.index;
    const ch = m[0];
    if (ch === ",") {
      const seg = text.slice(segStart, i);
      if (parts === null) value = value + seg;
      else { parts.push(seg); value = parts.join(""); }
      added += seg.length;
      return [value, 0, i + 1, line, added];
    }
    if (ch === "\n") {
      const seg = text.slice(segStart, i);
      if (parts === null) value = value + seg;
      else { parts.push(seg); value = parts.join(""); }
      added += seg.length;
      return [value, 1, i + 1, line + 1, added];
    }
    // "\r": CRLF ends the line, a lone CR is dropped (stray_cr).
    if (text[i + 1] === "\n") {
      const seg = text.slice(segStart, i);
      if (parts === null) value = value + seg;
      else { parts.push(seg); value = parts.join(""); }
      added += seg.length;
      return [value, 1, i + 2, line + 1, added];
    }
    errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
    if (parts === null) parts = [value];
    parts.push(text.slice(segStart, i));
    added += i - segStart;
    pos = i + 1;
    segStart = pos;
  }
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text[pos];
      if (c === "\n") { pos += 1; line += 1; }
      else if (c === "\r" && text[pos + 1] === "\n") { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    // Fast path: a whole record with no quote in its line and no stray CR
    // is just its fields split at commas (a CRLF ending loses its CR).
    const ni0 = text.indexOf("\n", pos);
    const lineEnd = ni0 === -1 ? n : ni0;
    const seg = text.slice(pos, lineEnd);
    let fields = null;
    if (seg.indexOf('"') === -1) {
      const ri0 = seg.indexOf("\r");
      if (ri0 === -1) fields = seg.split(",");
      else if (ni0 !== -1 && ri0 === seg.length - 1) fields = seg.slice(0, -1).split(",");
    }
    let quoted = false;
    if (fields !== null) {
      pos = ni0 === -1 ? n : ni0 + 1;
      if (ni0 !== -1) line += 1;
    } else {
      fields = [];
      let ended = 0; // 0 comma, 1 line break, 2 end
      do {
        if (text[pos] === '"') {
          quoted = true;
          const open = pos;
          let q = pos + 1;
          let start = q;
          let parts = null;
          let qi = -1;
          let closed = false;
          for (;;) {
            qi = text.indexOf('"', q);
            if (qi === -1) break;
            if (text[qi + 1] === '"') {
              if (parts === null) parts = [];
              parts.push(text.slice(start, qi + 1));
              q = qi + 2;
              start = q;
              continue;
            }
            closed = true;
            break;
          }
          if (!closed) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
            const r = readUnquoted(text, n, open + 1, line, recordLine, recordRow, errors, '"');
            fields.push(r[0]);
            ended = r[1];
            pos = r[2];
            line = r[3];
            continue;
          }
          let value;
          if (parts === null) value = text.slice(pos + 1, qi);
          else { parts.push(text.slice(start, qi)); value = parts.join(""); }
          // CRLF and lone CR inside quotes each read as LF, and each counts
          // as one more line.
          if (value.indexOf("\n") !== -1 || value.indexOf("\r") !== -1) {
            let nl = 0;
            let out = "";
            let s = 0;
            for (let i = 0; i < value.length; i++) {
              const ch = value[i];
              if (ch === "\r") {
                nl += 1;
                out += value.slice(s, i) + "\n";
                if (value[i + 1] === "\n") i += 1;
                s = i + 1;
              } else if (ch === "\n") {
                nl += 1;
              }
            }
            out += value.slice(s);
            value = out;
            line += nl;
          }
          pos = qi + 1;
          if (pos >= n) {
            ended = 2;
          } else {
            const c = text[pos];
            if (c === ",") { pos += 1; ended = 0; }
            else if (c === "\n") { pos += 1; line += 1; ended = 1; }
            else if (c === "\r" && text[pos + 1] === "\n") { pos += 2; line += 1; ended = 1; }
            else {
              // What follows the closing quote is appended as it stands.
              const r = readUnquoted(text, n, pos, line, recordLine, recordRow, errors, value);
              value = r[0];
              ended = r[1];
              pos = r[2];
              line = r[3];
              if (r[4] > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
            }
          }
          fields.push(value);
        } else {
          quoted = false;
          DELIM.lastIndex = pos;
          const m = DELIM.exec(text);
          let value;
          if (m === null) {
            value = text.slice(pos);
            pos = n;
            ended = 2;
          } else {
            const i = m.index;
            const ch = m[0];
            if (ch === ",") {
              value = text.slice(pos, i);
              pos = i + 1;
              ended = 0;
            } else if (ch === "\n") {
              value = text.slice(pos, i);
              pos = i + 1;
              line += 1;
              ended = 1;
            } else if (text[i + 1] === "\n") {
              value = text.slice(pos, i);
              pos = i + 2;
              line += 1;
              ended = 1;
            } else {
              const r = readUnquoted(text, n, pos, line, recordLine, recordRow, errors, "");
              value = r[0];
              ended = r[1];
              pos = r[2];
              line = r[3];
            }
          }
          fields.push(value);
        }
      } while (ended === 0);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
