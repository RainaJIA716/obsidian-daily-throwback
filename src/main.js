'use strict';
const {
  Plugin, MarkdownRenderChild, MarkdownRenderer, Component, PluginSettingTab, Setting,
  Notice, TFile, Keymap, setIcon, moment,
} = require('obsidian');
const { t } = require('./i18n.js');
const { LANGS, DailyIndex, stripForCard, hasBlock, planInsert } = require('./index.js');

const DEFAULTS = { format: 'YYYY-MM-DD', folder: '', expandFirst: false };

// Old notes are re-rendered at most this often while they are being edited
// in another pane.
const REFRESH_MS = 500;

module.exports = class DailyThrowbackPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.index = new DailyIndex(() => this.settings, moment);
    this.blocks = new Set();
    this.ready = false;

    const handler = (source, el, ctx) => {
      // A card renders an old note, and that note may hold its own block.
      // stripForCard removes it first; this is the second line of defence.
      if (el.closest('.dt-card-body')) return;
      ctx.addChild(new ThrowbackBlock(this, el, ctx.sourcePath));
    };
    for (const lang of LANGS) this.registerMarkdownCodeBlockProcessor(lang, handler);

    this.addCommand({
      id: 'insert-block',
      name: t.insertCommand,
      editorCallback: (editor, view) => this.insertBlock(editor, view),
    });

    this.addSettingTab(new ThrowbackSettingTab(this.app, this));

    // Build the index once the vault has loaded; registering the vault events
    // here also skips the flood of "create" events fired during startup.
    this.app.workspace.onLayoutReady(() => {
      this.index.rebuild(this.app.vault.getMarkdownFiles());
      this.ready = true;
      this.registerEvent(this.app.vault.on('create', (f) => {
        if (f instanceof TFile) this.changed(this.index.add(f), f.path);
      }));
      this.registerEvent(this.app.vault.on('delete', (f) => {
        this.changed(this.index.remove(f.path), f.path);
      }));
      this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
        this.changed(this.index.remove(oldPath), oldPath);
        if (f instanceof TFile) this.changed(this.index.add(f), f.path);
      }));
      this.registerEvent(this.app.vault.on('modify', (f) => {
        for (const b of this.blocks) b.noteModified(f.path);
      }));
      for (const b of this.blocks) b.render();
    });
  }

  // A daily note under `key` appeared, went away or moved.
  changed(key, path) {
    if (!key) return;
    for (const b of this.blocks) b.listChanged(key, path);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    if (!this.ready) return;
    this.index.rebuild(this.app.vault.getMarkdownFiles());
    for (const b of this.blocks) b.render();
  }

  insertBlock(editor, view) {
    const text = editor.getValue();
    if (hasBlock(text)) { new Notice(t.alreadyThere); return; }
    const cache = view && view.file ? this.app.metadataCache.getFileCache(view.file) : null;
    const fmEnd = cache && cache.frontmatterPosition ? cache.frontmatterPosition.end.line : undefined;
    const plan = planInsert(text, fmEnd, t.heading);
    const line = Math.min(plan.line, editor.lineCount());
    if (line >= editor.lineCount()) {
      // Past the last line: start a new one first.
      const last = editor.lineCount() - 1;
      editor.replaceRange('\n' + plan.text, { line: last, ch: editor.getLine(last).length });
    } else {
      editor.replaceRange(plan.text, { line, ch: 0 });
    }
    new Notice(t.inserted);
  }
};

// One rendered code block. Lives as long as Obsidian keeps the block on screen.
class ThrowbackBlock extends MarkdownRenderChild {
  constructor(plugin, el, sourcePath) {
    super(el);
    this.plugin = plugin;
    this.sourcePath = sourcePath;
    this.key = null;
    this.shown = new Map();    // path → { card, body, rendered }
    this.openPaths = new Set();
    this.timers = new Map();
    this.content = null;
  }

  onload() {
    this.plugin.blocks.add(this);
    // Keep clicks inside the cards from moving the editor cursor into the
    // block's source in Live Preview. Default actions (folding, links) still run.
    this.registerDomEvent(this.containerEl, 'mousedown', (e) => e.stopPropagation());
    this.registerDomEvent(this.containerEl, 'click', (e) => this.onClick(e));
    this.render();
  }

  onunload() {
    this.plugin.blocks.delete(this);
    for (const id of this.timers.values()) clearTimeout(id);
    this.timers.clear();
  }

  // Throw away whatever the previous render produced, child components included.
  reset() {
    if (this.content) this.removeChild(this.content);
    this.content = this.addChild(new Component());
    this.containerEl.empty();
    this.shown.clear();
  }

  render() {
    this.reset();
    const root = this.containerEl.createDiv({ cls: 'dt-root' });
    if (!this.plugin.ready) return;

    const app = this.plugin.app;
    const file = app.vault.getAbstractFileByPath(this.sourcePath);
    const past = file ? this.plugin.index.pastFor(file) : null;
    if (!past) {
      this.key = null;
      root.createDiv({ cls: 'dt-hint', text: t.notDaily });
      return;
    }
    this.key = this.plugin.index.parse(file).key;
    if (!past.length) {
      root.createDiv({ cls: 'dt-hint', text: t.none });
      return;
    }

    past.forEach((entry, i) => {
      const open = this.openPaths.has(entry.file.path) || (i === 0 && this.plugin.settings.expandFirst);
      this.addCard(root, entry, open);
    });
  }

  addCard(root, entry, open) {
    const card = root.createEl('details', { cls: 'dt-card' });
    const summary = card.createEl('summary', { cls: 'dt-summary' });
    setIcon(summary.createSpan({ cls: 'dt-chevron' }), 'chevron-right');
    summary.createSpan({ cls: 'dt-date', text: entry.date.format('YYYY-MM-DD') });
    summary.createSpan({ cls: 'dt-weekday', text: entry.date.format('ddd') });
    summary.createSpan({ cls: 'dt-ago', text: t.yearsAgo(entry.yearsAgo) });
    const openBtn = summary.createSpan({ cls: 'dt-open clickable-icon', attr: { 'aria-label': t.open, role: 'button' } });
    setIcon(openBtn, 'arrow-up-right');
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.app.workspace.openLinkText(entry.file.path, this.sourcePath, Keymap.isModEvent(e));
    });

    const body = card.createDiv({ cls: 'dt-card-body' });
    const slot = { card, body, entry, rendered: false };
    this.shown.set(entry.file.path, slot);

    // Old notes are only read and rendered when their card is opened.
    card.addEventListener('toggle', () => {
      if (card.open) {
        this.openPaths.add(entry.file.path);
        if (!slot.rendered) this.renderBody(slot);
      } else {
        this.openPaths.delete(entry.file.path);
      }
    });
    if (open) {
      card.open = true;
      this.openPaths.add(entry.file.path);
      this.renderBody(slot);
    }
  }

  async renderBody(slot) {
    slot.rendered = true;
    const { app } = this.plugin;
    const file = slot.entry.file;
    const content = this.content;
    const text = await app.vault.cachedRead(file);
    // The block may have re-rendered while we were reading.
    if (content !== this.content || this.shown.get(file.path) !== slot) return;
    const cache = app.metadataCache.getFileCache(file);
    const fmEnd = cache && cache.frontmatterPosition ? cache.frontmatterPosition.end.offset : undefined;
    const md = stripForCard(text, fmEnd);
    slot.body.empty();
    if (!md) {
      slot.body.createDiv({ cls: 'dt-hint', text: t.emptyNote });
      return;
    }
    const inner = slot.body.createDiv({ cls: 'dt-markdown markdown-rendered' });
    await MarkdownRenderer.render(app, md, inner, file.path, content);
  }

  // Links inside a rendered old note resolve relative to that note.
  onClick(e) {
    const a = e.target && e.target.closest ? e.target.closest('a.internal-link') : null;
    if (!a) return;
    const bodyEl = a.closest('.dt-card-body');
    const slot = [...this.shown.values()].find((s) => s.body === bodyEl);
    if (!slot) return;
    // In Reading view the page's own link handler would also fire, resolving
    // the link against the wrong note.
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute('data-href') || a.getAttribute('href');
    this.plugin.app.workspace.openLinkText(href, slot.entry.file.path, Keymap.isModEvent(e));
  }

  // The list of notes for `key` changed. The note holding this block is not
  // part of its own list, so its own creation/rename never triggers a redraw.
  listChanged(key, path) {
    if (key !== this.key || path === this.sourcePath) return;
    this.schedule('*', () => this.render());
  }

  // An old note shown here was edited: refresh only its card, and only if it
  // has been opened. Edits to the note holding this block are ignored, so
  // typing below the block never makes it redraw.
  noteModified(path) {
    if (path === this.sourcePath) return;
    const slot = this.shown.get(path);
    if (!slot || !slot.rendered) return;
    this.schedule(path, () => {
      const cur = this.shown.get(path);
      if (cur) this.renderBody(cur);
    });
  }

  schedule(id, fn) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); fn(); }, REFRESH_MS));
  }
}

class ThrowbackSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t.formatName).setDesc(t.formatDesc).addText((c) => c
      .setPlaceholder(DEFAULTS.format)
      .setValue(s.format)
      .onChange(async (v) => { s.format = v.trim() || DEFAULTS.format; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.folderName).setDesc(t.folderDesc).addText((c) => c
      .setPlaceholder('10-LIFE')
      .setValue(s.folder)
      .onChange(async (v) => { s.folder = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.expandName).setDesc(t.expandDesc).addToggle((c) => c
      .setValue(s.expandFirst)
      .onChange(async (v) => { s.expandFirst = v; await this.plugin.saveSettings(); }));
  }
}
