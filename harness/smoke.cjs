// Smoke test for Daily Throwback: unit-checks the pure logic in src/index.js,
// then loads the built main.js against jsdom with the Obsidian API stubbed and
// drives the real code paths.
const path = require("path");
const Module = require("module");
const { JSDOM } = require("jsdom");
const moment = require("moment");

const PLUGIN = path.join(__dirname, "..");

let failures = 0;
function check(label, cond, detail) {
	if (cond) console.log("  ok   " + label);
	else { failures++; console.log("  FAIL " + label + (detail ? "  → " + detail : "")); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 5; i++) await wait(0); }

// ---------- DOM ----------
const dom = new JSDOM(`<!doctype html><html><body><div id="host"></div></body></html>`, { pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.HTMLElement = window.HTMLElement;
global.Event = window.Event;

// ---------- Obsidian's DOM augmentations ----------
const P = window.HTMLElement.prototype;
function build(tag, o = {}) {
	if (typeof o === "string") o = { cls: o };
	const el = window.document.createElement(tag);
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o.text) el.textContent = o.text;
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
	return el;
}
P.createEl = function (tag, o) { const e = build(tag, o); this.appendChild(e); return e; };
P.createDiv = function (o) { return this.createEl("div", o); };
P.createSpan = function (o) { return this.createEl("span", o); };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };

// ---------- the obsidian module ----------
class Component {
	constructor() { this._children = []; this._cleanups = []; this._loaded = false; }
	load() { this._loaded = true; this.onload(); for (const c of this._children) c.load(); }
	unload() {
		for (const c of this._children) c.unload();
		this._children = [];
		for (const f of this._cleanups.splice(0)) f();
		this._loaded = false;
		this.onunload();
	}
	onload() {}
	onunload() {}
	addChild(c) { this._children.push(c); if (this._loaded) c.load(); return c; }
	removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) { this._children.splice(i, 1); c.unload(); } return c; }
	register(f) { this._cleanups.push(f); }
	registerEvent(ref) { this._cleanups.push(() => ref.off()); }
	registerDomEvent(el, type, fn) { el.addEventListener(type, fn); this._cleanups.push(() => el.removeEventListener(type, fn)); }
}
class MarkdownRenderChild extends Component { constructor(el) { super(); this.containerEl = el; } }
class Plugin extends Component {
	constructor(app) { super(); this.app = app; this._commands = []; this._blocks = {}; }
	registerMarkdownCodeBlockProcessor(lang, fn) { this._blocks[lang] = fn; }
	addCommand(c) { this._commands.push(c); }
	addSettingTab(tab) { this._tab = tab; }
	async loadData() { return this._saved || null; }
	async saveData(d) { this._saved = JSON.parse(JSON.stringify(d)); }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = build("div"); } }
class Setting {
	constructor() {}
	setName() { return this; } setDesc() { return this; }
	addText(fn) { const c = { setPlaceholder: () => c, setValue: () => c, onChange: () => c }; fn(c); return this; }
	addToggle(fn) { const c = { setValue: () => c, onChange: () => c }; fn(c); return this; }
}
const notices = [];
class Notice { constructor(m) { notices.push(m); } }
class TFile { constructor(p) { this.path = p; this.basename = path.basename(p, ".md"); this.extension = "md"; } }
const renders = [];
const MarkdownRenderer = {
	async render(app, md, el, sourcePath, component) {
		renders.push({ md, sourcePath, component });
		el.createDiv({ cls: "rendered", text: md });
		// Imitate Obsidian: a fenced block of ours inside the rendered markdown
		// would be handed to the code block processor, with the element in place.
		if (/```on-this-day/.test(md)) {
			const nested = el.createDiv({ cls: "block-language-on-this-day" });
			pluginRef._blocks["on-this-day"]("", nested, { sourcePath, addChild: (c) => { nestedAdds.push(c); c.load(); } });
		}
		const a = el.createEl("a", { cls: "internal-link", attr: { "data-href": "其他笔记", href: "其他笔记" } });
		a.textContent = "link";
	},
};
let pluginRef = null;
const nestedAdds = [];

Module._resolveFilename = ((orig) => function (request, ...rest) {
	if (request === "obsidian") return "obsidian";
	return orig.call(this, request, ...rest);
})(Module._resolveFilename);
require.cache["obsidian"] = {
	id: "obsidian", filename: "obsidian", loaded: true,
	exports: {
		Plugin, Component, MarkdownRenderChild, MarkdownRenderer, PluginSettingTab, Setting, Notice, TFile,
		Keymap: { isModEvent: () => false }, setIcon: () => {}, moment, getLanguage: () => "en",
	},
};

// ---------- a vault ----------
const FM = "---\ntags:\n  - Daily\n---\n";
const NOTES = {
	"10-LIFE/2026/10月/2026-10-07.md": FM + "## 往年今日\n```on-this-day\n```\n\n## today\n今天写的",
	"10-LIFE/2025/10月/2025-10-07.md": FM + "## 往年今日\n```on-this-day\n```\n\n## today\n去年今天 ![[图.webp]]",
	"10-LIFE/2023/2023-10-07.md": "前年的，没有 frontmatter",
	"10-LIFE/2021/2021-10-07.md": "",
	"old/2019-10-07.md": "## 记录\n2019 年的",
	"10-LIFE/2026/周报/2026-01-W05.md": "周报",
	"+/1-短想法/20231101网络冲浪可爱语句.md": "不是日记",
	"10-LIFE/2026/10月/2026-10-08.md": "明天",
	"随便一篇.md": "```on-this-day\n```",
};
const files = new Map(Object.keys(NOTES).map((p) => [p, new TFile(p)]));
const handlers = {};
function trigger(name, ...args) { for (const h of handlers[name] || []) h(...args); }
let readyFn = null;
const opened = [];
const app = {
	vault: {
		getMarkdownFiles: () => [...files.values()],
		getAbstractFileByPath: (p) => files.get(p) || null,
		cachedRead: async (f) => NOTES[f.path],
		on: (name, fn) => {
			(handlers[name] = handlers[name] || []).push(fn);
			return { off: () => { handlers[name] = handlers[name].filter((h) => h !== fn); } };
		},
	},
	metadataCache: {
		getFileCache: (f) => {
			const m = (NOTES[f.path] || "").match(/^---\n[\s\S]*?\n---\n?/);
			if (!m) return {};
			const lines = m[0].replace(/\n$/, "").split("\n").length;
			return { frontmatterPosition: { end: { offset: m[0].replace(/\n$/, "").length, line: lines - 1 } } };
		},
	},
	workspace: {
		onLayoutReady: (fn) => { readyFn = fn; },
		openLinkText: (link, source) => opened.push([link, source]),
	},
};

// ================= pure logic =================
const idx = require(path.join(PLUGIN, "src/index.js"));
console.log("index.js");
{
	const s = { format: "YYYY-MM-DD", folder: "" };
	const p = (f) => idx.parseDaily(new TFile(f), s, moment);
	check("2025-10-07 is a daily note", p("a/2025-10-07.md") && p("a/2025-10-07.md").key === "10-07");
	check("weekly note 2026-01-W05 is not", p("a/2026-01-W05.md") === null);
	check("clipping 20231101标题 is not", p("a/20231101网络冲浪.md") === null);
	check("clipping 2025-05-06T172238 is not", p("a/2025-05-06T172238+0800  复盘.md") === null);
	check("folder limit keeps notes inside", idx.parseDaily(new TFile("10-LIFE/x/2025-10-07.md"), { ...s, folder: "/10-LIFE/" }, moment) !== null);
	check("folder limit drops notes outside", idx.parseDaily(new TFile("old/2019-10-07.md"), { ...s, folder: "10-LIFE" }, moment) === null);
	check("folder limit does not match a prefix", idx.parseDaily(new TFile("10-LIFE-old/2019-10-07.md"), { ...s, folder: "10-LIFE" }, moment) === null);
	check("format with folders uses the last segment", idx.parseDaily(new TFile("x/2025-10-07.md"), { ...s, format: "YYYY/M月/YYYY-MM-DD" }, moment) !== null);

	const di = new idx.DailyIndex(() => s, moment);
	di.rebuild(["2019", "2021", "2023", "2025", "2026"].map((y) => new TFile(`d/${y}-10-07.md`)).concat(new TFile("d/2026-10-08.md")));
	const got = di.pastFor(new TFile("d/2026-10-07.md"));
	check("2026 shows every earlier year, newest first", got.map((e) => e.year).join() === "2025,2023,2021,2019", got.map((e) => e.year).join());
	check("years-ago counts", got.map((e) => e.yearsAgo).join() === "1,3,5,7");
	check("2021 shows only earlier years", di.pastFor(new TFile("d/2021-10-07.md")).map((e) => e.year).join() === "2019");
	check("the earliest year shows nothing", di.pastFor(new TFile("d/2019-10-07.md")).length === 0);
	check("non-daily note returns null", di.pastFor(new TFile("d/hello.md")) === null);
	di.remove("d/2023-10-07.md");
	check("remove takes a note out", di.pastFor(new TFile("d/2026-10-07.md")).length === 3);

	di.rebuild([new TFile("d/2024-02-29.md"), new TFile("d/2027-02-28.md"), new TFile("d/2020-02-29.md")]);
	check("Feb 29 matches other leap years only", di.pastFor(new TFile("d/2028-02-29.md")).map((e) => e.year).join() === "2024,2020");
	check("Feb 28 does not pick up Feb 29", di.pastFor(new TFile("d/2030-02-28.md")).map((e) => e.year).join() === "2027");

	const tpl = FM + "## 往年今日\n```on-this-day\n```\n\n## today\n内容\n```js\nlet a = 1;\n```";
	const fmEnd = FM.length - 1;
	const out = idx.stripForCard(tpl, fmEnd);
	check("card drops frontmatter, our block and the empty module heading",
		out === "内容\n```js\nlet a = 1;\n```", JSON.stringify(out));
	check("card drops frontmatter without a cache offset", idx.stripForCard(FM + "正文") === "正文");
	check("the Chinese block name is dropped too", idx.stripForCard("```往年今日\n```\n正文") === "正文");
	check("a module heading with real content under it is kept", idx.stripForCard("## 往年今日\n手写的回顾\n## 记录") === "## 往年今日\n手写的回顾\n## 记录");
	check("our block inside a longer fence is left alone",
		idx.stripForCard("````md\n```on-this-day\n```\n````") === "````md\n```on-this-day\n```\n````");
	check("card hides the ## today heading but keeps what is under it",
		idx.stripForCard(FM + "## 往年今日\n```on-this-day\n```\n\n## today\n## 记录\n正文", FM.length - 1) === "## 记录\n正文");
	check("card hides ## today before plain text", idx.stripForCard("## 往年今日\n```on-this-day\n```\n\n## today\n\n`10:17`\n正文") === "`10:17`\n正文");
	check("a heading that merely contains today is kept", idx.stripForCard("## today 的想法\n正文") === "## today 的想法\n正文");
	check("hasBlock sees the block", idx.hasBlock("a\n```on-this-day\n```") && !idx.hasBlock("```js\n```"));

	const ins1 = idx.planInsert(FM + "## 往年今日\n\n\n## today\n", 3, "往年今日");
	check("insert goes under an existing module heading", ins1.line === 5 && ins1.text === "```on-this-day\n```\n", JSON.stringify(ins1));
	const ins2 = idx.planInsert(FM + "正文", 3, "往年今日");
	check("insert goes after frontmatter with a heading and ## today", ins2.line === 4 && ins2.text === "## 往年今日\n```on-this-day\n```\n\n## today\n", JSON.stringify(ins2));
	check("no second ## today when the note has one", idx.planInsert("正文\n## today\n更多", undefined, "往年今日").text === "## 往年今日\n```on-this-day\n```\n\n");
	check("insert goes to line 0 without frontmatter", idx.planInsert("正文", undefined, "往年今日").line === 0);
}

// ================= plugin =================
(async () => {
	console.log("main.js");
	const PluginClass = require(path.join(PLUGIN, "main.js"));
	const plugin = new PluginClass(app);
	pluginRef = plugin;
	await plugin.onload();
	plugin._loaded = true;

	check("registers on-this-day", typeof plugin._blocks["on-this-day"] === "function");
	check("registers the Chinese alias", typeof plugin._blocks["往年今日"] === "function");
	check("registers the insert command", plugin._commands.some((c) => c.id === "insert-block"));

	const host = document.getElementById("host");
	function mount(sourcePath) {
		const el = host.createDiv({ cls: "block-language-on-this-day" });
		let child = null;
		plugin._blocks["on-this-day"]("", el, { sourcePath, addChild: (c) => { child = c; c.load(); } });
		return { el, child };
	}

	const today = mount("10-LIFE/2026/10月/2026-10-07.md");
	check("before the vault is ready the block is empty", today.el.querySelectorAll(".dt-card").length === 0);

	readyFn();
	await settle();
	const cards = () => [...today.el.querySelectorAll(".dt-card")];
	check("after ready: four cards for 2025/2023/2021/2019", cards().length === 4, "got " + cards().length);
	check("cards are newest first", cards().map((c) => c.querySelector(".dt-date").textContent).join() === "2025-10-07,2023-10-07,2021-10-07,2019-10-07");
	check("cards show years ago", cards()[0].querySelector(".dt-ago").textContent.includes("1"));
	check("weekly notes and clippings are not cards", !today.el.textContent.includes("W05"));
	check("cards start folded", cards().every((c) => !c.open));
	check("nothing is read or rendered before a card opens", renders.length === 0);

	// open the first card
	const first = cards()[0];
	first.open = true;
	first.dispatchEvent(new Event("toggle"));
	await settle();
	check("opening a card renders that note once", renders.length === 1, "renders " + renders.length);
	check("rendered against the old note's path", renders[0] && renders[0].sourcePath === "10-LIFE/2025/10月/2025-10-07.md");
	check("rendered markdown has no frontmatter / nested block",
		renders[0] && renders[0].md === "去年今天 ![[图.webp]]", renders[0] && JSON.stringify(renders[0].md));
	first.dispatchEvent(new Event("toggle"));
	await settle();
	check("re-toggling does not render again", renders.length === 1);

	// empty note
	const empty = cards()[2];
	empty.open = true; empty.dispatchEvent(new Event("toggle"));
	await settle();
	check("an empty old note shows a hint", empty.querySelector(".dt-hint") !== null);

	// nested guard: even if a block slipped through, it draws nothing in a card
	const fakeBody = host.createDiv({ cls: "dt-card-body" });
	const nestedEl = fakeBody.createDiv();
	let nestedChild = null;
	plugin._blocks["on-this-day"]("", nestedEl, { sourcePath: "10-LIFE/2025/10月/2025-10-07.md", addChild: (c) => { nestedChild = c; } });
	check("a block inside a card draws nothing", nestedChild === null && nestedEl.childNodes.length === 0);

	// links inside a card resolve against the old note
	const link = first.querySelector("a.internal-link");
	link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	check("internal link opens relative to the old note", opened.length === 1 && opened[0][1] === "10-LIFE/2025/10月/2025-10-07.md", JSON.stringify(opened));

	// typing in today's note must not redraw the block
	const before = cards()[0];
	for (let i = 0; i < 5; i++) trigger("modify", files.get("10-LIFE/2026/10月/2026-10-07.md"));
	await wait(650);
	check("editing the note itself never redraws the block", cards()[0] === before && renders.length === 1, "renders " + renders.length);

	// editing an opened old note refreshes just its card
	NOTES["10-LIFE/2025/10月/2025-10-07.md"] = "改过了";
	trigger("modify", files.get("10-LIFE/2025/10月/2025-10-07.md"));
	trigger("modify", files.get("10-LIFE/2025/10月/2025-10-07.md"));
	await wait(650);
	check("editing an opened old note re-renders it once", renders.length === 2 && renders[1].md === "改过了", "renders " + renders.length);
	check("…without redrawing the other cards", cards()[0] === before);

	// a closed card's note being edited costs nothing
	trigger("modify", files.get("old/2019-10-07.md"));
	await wait(650);
	check("editing a never-opened note renders nothing", renders.length === 2);

	// backfilling an older year
	const f2024 = new TFile("补/2024-10-07.md");
	files.set(f2024.path, f2024); NOTES[f2024.path] = "补的";
	trigger("create", f2024);
	trigger("create", new TFile("别的/2024-10-09.md"));
	await wait(650);
	check("a backfilled year appears", cards().length === 5 && cards()[1].querySelector(".dt-date").textContent === "2024-10-07");
	check("open cards stay open after a redraw", cards()[0].open === true);

	trigger("delete", f2024); files.delete(f2024.path);
	await wait(650);
	check("deleting it takes it away", cards().length === 4);

	const oldPath = "old/2019-10-07.md";
	const moved = new TFile("10-LIFE/2019/2019-10-07.md");
	files.delete(oldPath); files.set(moved.path, moved); NOTES[moved.path] = NOTES[oldPath];
	trigger("rename", moved, oldPath);
	await wait(650);
	check("renaming keeps the card", cards().length === 4);

	// other notes
	const tomorrow = mount("10-LIFE/2026/10月/2026-10-08.md");
	check("a day with no earlier years says so", tomorrow.el.querySelector(".dt-hint") !== null && tomorrow.el.querySelectorAll(".dt-card").length === 0);
	const notDaily = mount("随便一篇.md");
	check("a non-daily note gets a hint", notDaily.el.querySelector(".dt-hint") !== null);

	// unload
	const count = plugin.blocks.size;
	today.child.unload();
	check("unloading a block unregisters it", plugin.blocks.size === count - 1);

	// insert command
	const cmd = plugin._commands.find((c) => c.id === "insert-block");
	function fakeEditor(text) {
		const ed = {
			text,
			getValue: () => ed.text,
			lineCount: () => ed.text.split("\n").length,
			getLine: (n) => ed.text.split("\n")[n],
			replaceRange: (s, pos) => {
				const lines = ed.text.split("\n");
				const offset = lines.slice(0, pos.line).reduce((a, l) => a + l.length + 1, 0) + pos.ch;
				ed.text = ed.text.slice(0, offset) + s + ed.text.slice(offset);
			},
		};
		return ed;
	}
	const ed1 = fakeEditor(NOTES["10-LIFE/2026/10月/2026-10-08.md"]);
	cmd.editorCallback(ed1, { file: files.get("10-LIFE/2026/10月/2026-10-08.md") });
	check("insert into a note without frontmatter", ed1.text.startsWith("## ") && ed1.text.includes("```on-this-day\n```\n\n## today\n明天"), JSON.stringify(ed1.text));
	const n = notices.length;
	cmd.editorCallback(ed1, { file: files.get("10-LIFE/2026/10月/2026-10-08.md") });
	check("insert twice is refused", notices.length === n + 1 && ed1.text.split("on-this-day").length === 2);
	const tplNote = "## 往年今日\n\n\n\n## today\n";
	const ed2 = fakeEditor(tplNote);
	cmd.editorCallback(ed2, { file: null });
	check("insert under the template's heading", ed2.text === "## 往年今日\n```on-this-day\n```\n\n\n\n## today\n", JSON.stringify(ed2.text));

	console.log(failures ? `\n${failures} FAILED` : "\nall passed");
	process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
