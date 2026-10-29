# Verification

## Current version: named projects and fitted A4 exports

- All 20 Node tests pass. Coverage includes parsing, natural sorting, duplicates, section operations, exact input preservation, named project snapshots, switching, renaming, duplicate-name protection, legacy draft migration, and unavailable/corrupt storage.
- Real PDFs were generated for all three export modes at each page choice. Nine 700-part stress PDFs have the requested 1, 2, or 3 A4 pages. Extracted text was checked with pypdf to confirm every reference, including actual duplicates, is present; Both includes each occurrence in each view.
- All six pages of the three final sample PDFs were rendered with Poppler and visually inspected. Headings, source labels, checkboxes, margins, and page numbers are clear. A dense continuation page and a Korean/Japanese name PDF were also rendered and inspected.
- Extremely short lists may use fewer pages than selected to avoid empty pages. Large fitted lists shrink text to retain all information.
- Browser workflow passes: a blank name prevents explicit saving; Save then New preserves the named build; two saved builds reopen with their original raw input; switching preserves later edits; reloading restores the current draft and project picker; duplicate names cannot overwrite a different build.
- Browser exports succeed at 1, 2, and 3 pages in Both mode with matching filenames. Opening another project clears an older PDF and restores the default one-page option.
- New controls were checked at CSS widths 1280 and 390 pixels with no horizontal overflow. Desktop has the named-project controls in a row; mobile stacks the picker. The final desktop screenshot is `screenshots/named-projects-export.png`.
- No browser warnings or errors were recorded. JavaScript syntax checks pass.

## Existing workflow verification

Previous checks covered adding custom sections, renaming, reordering, deleting and undoing, both cutting views, invalid input feedback and correction, keyboard navigation, and restoration of names, order, raw text, and selected view. Responsive checks also covered 985, 320, and 300 pixels.

## Preview limitations

Browser QA for this change used a separate local origin on port 8081, preserving existing work on the usual port 8080. Test projects remain only in the QA origin's browser storage. The app has no preset sections.

The preview tool disallows `file://` URLs, so direct-file mode was not browser-tested. Deferred ordinary scripts and relative local CSS/JS support opening `dist/index.html` without a build or network dependencies. Use the same local-server address and browser profile for predictable saved-project storage.

The in-app browser's download-capture APIs previously timed out for PDF Blob downloads; actual file saving from that preview could not be confirmed. Browser generation status, the persistent save link, and filenames were verified. The PDF bytes were independently generated and inspected using the same exporter. The app uses standard browser PDF Blob downloads with a persistent user-clickable save link.
