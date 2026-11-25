# Changelog

## 0.1.2

### Fixed

- Date-named attachments are no longer mistaken for daily notes when they are created or renamed while Obsidian is running. Previously, an attachment such as `2025-06-25.webp` could add a duplicate card and display its binary contents as garbled text; Daily Throwback now indexes Markdown files only.

## 0.1.1

- Improved compatibility with older Obsidian versions by removing `:has()` selectors and browser storage usage.

## 0.1.0

- Initial release.
