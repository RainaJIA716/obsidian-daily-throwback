'use strict';
// Pure logic: which notes are daily notes, which ones share today's month-day,
// and what part of an old note gets shown. No DOM, no Obsidian objects beyond
// plain { path, basename } — so the harness can drive it directly.

// Code block names this plugin answers to. The first one is what the insert
// command writes; the Chinese one is an alias for people who prefer it.
const LANGS = ['on-this-day', '往年今日'];

// Heading names the insert command uses. When an old note is shown inside a
// card, a heading with one of these names that has nothing left under it is
// dropped along with the code block, so cards don't nest.
const HEADINGS = ['往年今日', 'On this day'];

// The heading the daily template puts under the module, where that day's
// writing starts. It says nothing inside a card, so cards leave it out.
const TODAY = 'today';

function normalizeFolder(folder) {
  return String(folder || '').trim().replace(/^\/+|\/+$/g, '');
}

function inFolder(path, folder) {
  const f = normalizeFolder(folder);
  return !f || path === f || path.startsWith(f + '/');
}

// The date format may carry folders ("YYYY/M月/YYYY-MM-DD", the way the core
// Daily notes plugin allows); only the last segment is the file name.
function basenameFormat(format) {
  const parts = String(format || 'YYYY-MM-DD').split('/');
  return parts[parts.length - 1] || 'YYYY-MM-DD';
}

// Returns { year, key: "MM-DD", date } or null. Strict parsing, so weekly
// notes like "2026-01-W05" and clippings like "20231101标题" don't count.
function parseDaily(file, settings, moment) {
  if (!file || !file.basename || !inFolder(file.path, settings.folder)) return null;
  const date = moment(file.basename, basenameFormat(settings.format), true);
  if (!date.isValid()) return null;
  return { year: date.year(), key: date.format('MM-DD'), date };
}

class DailyIndex {
  constructor(getSettings, moment) {
    this.getSettings = getSettings;
    this.moment = moment;
    this.byKey = new Map();   // "MM-DD" → Map<path, { file, year, date }>
    this.keyOf = new Map();   // path → "MM-DD"
  }

  parse(file) {
    return parseDaily(file, this.getSettings(), this.moment);
  }

  rebuild(files) {
    this.byKey.clear();
    this.keyOf.clear();
    for (const f of files) this.add(f);
  }

  // Returns the key the file was filed under, or null if it isn't a daily note.
  add(file) {
    const info = this.parse(file);
    if (!info) return null;
    if (!this.byKey.has(info.key)) this.byKey.set(info.key, new Map());
    this.byKey.get(info.key).set(file.path, { file, year: info.year, date: info.date });
    this.keyOf.set(file.path, info.key);
    return info.key;
  }

  remove(path) {
    const key = this.keyOf.get(path);
    if (!key) return null;
    this.keyOf.delete(path);
    const bucket = this.byKey.get(key);
    if (bucket) {
      bucket.delete(path);
      if (!bucket.size) this.byKey.delete(key);
    }
    return key;
  }

  // Every earlier year's note for the same month-day, newest first, however
  // many years back. The note itself and later years are left out.
  pastFor(file) {
    const info = this.parse(file);
    if (!info) return null;
    const bucket = this.byKey.get(info.key);
    if (!bucket) return [];
    const out = [];
    for (const e of bucket.values()) {
      if (e.file.path === file.path || e.year >= info.year) continue;
      out.push({ file: e.file, year: e.year, date: e.date, yearsAgo: info.year - e.year });
    }
    out.sort((a, b) => b.year - a.year || a.file.path.localeCompare(b.file.path));
    return out;
  }
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

// What a card shows of an old note: the note without its frontmatter, without
// any of our own code blocks, without a module heading left empty by that,
// and without the "## today" heading line (what's under it stays).
function stripForCard(text, frontmatterEnd) {
  let body = String(text || '');
  if (typeof frontmatterEnd === 'number' && frontmatterEnd > 0) {
    body = body.slice(frontmatterEnd);
  } else {
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  }

  const lines = body.split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_OPEN);
    if (!m) { kept.push(lines[i]); continue; }
    const fence = m[1];
    let j = i + 1;
    while (j < lines.length && !new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[j])) j++;
    if (LANGS.includes(m[2])) { i = j; continue; }   // drop our block, fences included
    for (let k = i; k <= j && k < lines.length; k++) kept.push(lines[k]);
    i = j;
  }

  const out = [];
  for (let i = 0; i < kept.length; i++) {
    const h = kept[i].match(HEADING);
    if (h && h[2].toLowerCase() === TODAY) continue;
    if (h && HEADINGS.includes(h[2])) {
      let j = i + 1;
      while (j < kept.length && kept[j].trim() === '') j++;
      if (j >= kept.length || HEADING.test(kept[j])) { i = j - 1; continue; }
    }
    out.push(kept[i]);
  }
  return out.join('\n').trim();
}

function hasBlock(text) {
  return String(text || '').split(/\r?\n/).some((l) => {
    const m = l.match(FENCE_OPEN);
    return m && LANGS.includes(m[2]);
  });
}

// Where the insert command puts the block, and what it writes. If the note
// already has the module heading (the template writes one), the code block
// goes right under it; otherwise heading + block go after the frontmatter,
// followed by a "## today" heading (unless the note already has one) so the
// module stays separated from the entry, the same as the template.
function planInsert(text, frontmatterEndLine, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const block = '```' + LANGS[0] + '\n```\n';
  let hasToday = false;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING);
    if (h && HEADINGS.includes(h[2])) return { line: i + 1, text: block };
    if (h && h[2].toLowerCase() === TODAY) hasToday = true;
  }
  const line = typeof frontmatterEndLine === 'number' ? frontmatterEndLine + 1 : 0;
  return { line, text: '## ' + heading + '\n' + block + '\n' + (hasToday ? '' : '## ' + TODAY + '\n') };
}

module.exports = { LANGS, HEADINGS, TODAY, normalizeFolder, inFolder, parseDaily, DailyIndex, stripForCard, hasBlock, planInsert };
