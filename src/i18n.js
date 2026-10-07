// Follows Obsidian's own interface language: Chinese when the app is in
// Chinese, English everywhere else. getLanguage() exists from Obsidian 1.8.7;
// before that, Obsidian sets moment's locale to the app language.
const obsidian = require("obsidian");

const STRINGS = {
	en: {
		heading: "On this day",
		yearsAgo: (n) => (n === 1 ? "1 year ago" : `${n} years ago`),
		none: "No entries from earlier years on this day yet.",
		notDaily: "This note's name isn't a date, so there is nothing to look back on.",
		emptyNote: "(This entry is empty.)",
		open: "Open this entry",
		insertCommand: "Insert the On this day block into this note",
		alreadyThere: "This note already has an On this day block.",
		inserted: "On this day block inserted.",
		formatName: "Date format",
		formatDesc: "How daily note file names are written, in Moment.js format. Only the file name is checked; folders in the format are ignored.",
		folderName: "Folder",
		folderDesc: "Only look for daily notes inside this folder (subfolders included). Leave empty to search the whole vault.",
		expandName: "Expand the most recent entry",
		expandDesc: "Open the newest card automatically. Off keeps every card folded, so the block stays a few lines tall.",
	},
	zh: {
		heading: "往年今日",
		yearsAgo: (n) => `${n} 年前`,
		none: "这一天还没有往年的日记",
		notDaily: "这篇笔记的文件名不是日期，没法找往年今日",
		emptyNote: "（这篇是空的）",
		open: "打开这篇日记",
		insertCommand: "在当前笔记插入往年今日模块",
		alreadyThere: "这篇笔记里已经有往年今日模块了",
		inserted: "已插入往年今日模块",
		formatName: "日期格式",
		formatDesc: "日记文件名的写法（Moment.js 格式）。只看文件名，格式里的文件夹部分会被忽略。",
		folderName: "限定文件夹",
		folderDesc: "只在这个文件夹（含子文件夹）里找日记。留空 = 全库找。",
		expandName: "自动展开最近一篇",
		expandDesc: "打开日记时自动展开最近一年的那张卡片。关掉则全部折叠，模块只占几行。",
	},
};

function pickLocale() {
	let lang = "en";
	try {
		lang = typeof obsidian.getLanguage === "function" ? obsidian.getLanguage() : obsidian.moment.locale();
	} catch (e) {
		lang = "en";
	}
	return String(lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

const t = STRINGS[pickLocale()];

module.exports = { t };
