# Runner Order

A small, offline-capable model kit cutting-list organiser, with an optional community kit library. The workbench needs no account, backend or build tools and works offline. PDF export uses one locally bundled, free MIT-licensed library (pdf-lib). Network requests happen only for the feedback form and, when switched on, the community library.

## Run locally

The easiest option: open `dist/index.html` in a browser. All assets are local and the app works without an internet connection.

For a stable browser-storage origin (recommended), run this from the project directory:

```sh
python3 -m http.server 8080 --directory dist --bind 127.0.0.1
```

Then open **http://127.0.0.1:8080**. Stop the server with Ctrl+C. This is a local static-file preview server, not an application backend.

Always use the same browser/profile and address to return to your saved work. Storage for a directly opened file is browser-dependent; the local server is more predictable. Private browsing and clearing browser data can remove saved work.

## Use

1. Name your project, then add any number of freely named sections. A name is optional while drafting and required for **Save project**.
2. Type or paste parts into each section. Inputs stay editable and save immediately.
3. Rename a section by editing its name. Use the arrows to reorder sections; delete a section with the trash button. The most recent deletion can be undone until the page reloads or another deletion replaces it.
4. Switch between **By Section** (one assembly at a time) and **By Runner** (all sections combined, with a source section beside each part).
5. Use **Save project** to keep the current inputs under that name. Choose a saved project and click **Open** to return to it, or **New project** to start a blank build. Starting or opening a project saves the current build first. Unnamed builds receive an “Untitled project” name. Duplicate names cannot overwrite a different saved build: Save project asks for a different name, and switching projects saves a clashing draft under a numbered name such as "Gus (2)".
6. Use **Export file** to download the current project as a `.json` file, as a backup or to move it to another browser or device. **Import file** opens such a file as a new saved project (the current build is saved first, and a clashing name becomes e.g. “ZZA Gus (2)”, so nothing is overwritten).
7. Click **Export PDF**, choose **By Section**, **By Runner**, or **Both**, select **1 page**, **2 pages**, or **3 pages**, then **Download PDF**. These choices are independent of the on-screen view.

## Themes and links

The header links to YK.Hobby on Instagram and Facebook, plus a **Money for backlog** button to YK.Hobby's Ko-fi page (https://ko-fi.com/ykhobby), all opening in a new tab. It also has a colour theme picker: **Auto** (follows the device's light/dark setting), **Default** (light, brand green), **Dark mode**, **RX-78-2** (white, grey, blue, red and yellow), **Char** (dark red) and **Strike Rouge** (rose pink and white). The choice is remembered in this browser under `runner-notes.theme` and applied before the page paints.

## Feedback

**Send feedback** (top right) opens a short form: message, name, and email (all required; the email must look like `you@example.com`), plus an optional attachment of the current project file. Replying to a feedback email goes straight to the tester. Submissions are posted to [Web3Forms](https://web3forms.com), which emails them to the inbox the access key was created with.

To connect it, create a free access key at web3forms.com using the address that should receive feedback, then paste it into `dist/config.js` as `feedbackAccessKey`. Until a key is set, the form explains that feedback isn't connected and sends nothing.

## Kit catalogue

The **Kit / project name** box suggests matching kits as you type, from a catalogue of about 2,700 Bandai kits. Typing "zaku ii", "aile strike" or a product code such as `2001365` all work. Picking one names the project (e.g. "MG Zaku II Ver. 2.0") and remembers its brand, grade, scale and product code, which carry through to sharing. Suggestions work offline and without an account.

The catalogue comes from [gunpla.fyi](https://gunpla.fyi) ([stevenla/gunpla-db](https://github.com/stevenla/gunpla-db)) and is used with the owner's permission. Only facts are copied: names, grade, scale, product code, release month and series, never box art. `node scripts/import-catalogue.mjs` rebuilds `dist/catalogue.json`. The "Refresh kit catalogue" workflow does this every Monday morning (Sydney time), committing and redeploying only when the list changed.

When the community library is on, every suggestion also shows "N parts lists" or "No parts list yet". The New project check lists catalogue kits under the shared parts lists, and a **Kit catalogue** page (`#/catalogue`) lets people filter by grade, scale and whether a parts list exists.

## Visit counts

When `goatcounterCode` is set in `dist/config.js`, `dist/analytics.js` loads GoatCounter (goatcounter.com): cookieless, no banner needed, and it doesn't count localhost. Besides page visits, including the community pages, it counts these actions, in the GoatCounter dashboard's events list:

| Event | When |
|---|---|
| `pdf-export` | A PDF is downloaded; the title is the layout, e.g. "By Section · 1 page". |
| `kit-picked` | A kit is chosen from the catalogue suggestions; the title is the kit name. |
| `project-file-export` / `project-file-import` | A project file is saved or opened. |
| `feedback-sent` | The feedback form is sent. |
| `outbound-instagram`, `outbound-facebook`, `outbound-ko-fi` | A header link is clicked. |
| `kit-shared`, `kit-updated`, `kit-used` | Community library actions, when it's switched on. |

Nothing a person types is ever sent. Tag shared links with `?ref=instagram` or `?ref=facebook` and GoatCounter lists them under referrers.

## Community library (optional)

When `dist/config.js` has Supabase settings, the app adds:
- **Accounts:** "Continue with Google" or an emailed sign-in link.
- **Cloud saves:** each saved project uploads to the person's account and appears on their other devices. The newest copy wins, and unsaved edits are never overwritten.
- **Check before you type:** New project asks "What are you building?" and searches the library by name or product code, filtered by brand, scale and line. People can use a match ready-made or start from scratch, and the details they enter carry through to sharing.
- **Share to community:** checks for similar kits first, then publishes a frozen copy of the part list under CC0.
- **Community kits** (`#/kits`): search and filter by brand, scale and line; kit pages (`#/kits/<id>`) with a preview, PDF download, "Use this kit", confirmations and reports.
- **Admin** (`#/admin`): reported kits, merging duplicates, promoting typed-in brands.

Without those settings, none of this appears and the app behaves exactly as before. The sign-in library (supabase-js 2.45.4) loads from jsDelivr only when the feature is on. Setup steps are in `docs/COMMUNITY-SETUP.md`.

## PDF cutting sheets

Exports use A4 portrait pages with project name, export date, page numbers, runner headings, and a checkbox for every part in runner lists. Section mode follows your custom section order and matches the app's look as a compact build cheat-sheet: each section heading shows its part count, and each runner's code sits beside its outlined part chips (no checkboxes), using up to three columns at the largest text size that fits. Runner mode naturally sorts every part across the whole project and shows its source section. Both includes the section list followed by the runner list in the same PDF.

The default fits all information onto **one A4 page**, including Both. Choose **two or three pages** to spread the list out. The layout balances content, uses a second column when helpful, and reduces text size as needed to keep every entry within the chosen page count. Very large lists can have small text even at three pages. Extremely short lists use fewer pages rather than adding empty sheets. Context headings repeat when a list continues on another page or column.

Fix unrecognised entries before exporting; the app blocks incomplete PDFs rather than silently omitting those entries. PDF generation uses a snapshot of your current inputs and does not change your project or selected cutting view. A save link remains available if the browser does not start downloading automatically. Editing the project hides an older PDF link so you can export an updated sheet.

All generation is local and works offline. Standard text remains selectable. Names outside the built-in PDF font's character set use the browser's local fonts, embedded as crisp PNGs; this supports names in languages such as Korean and Japanese without downloading fonts. The filename includes the project name, chosen mode, and page setting.

Accepted examples: `A15 A3, b12`, new lines, `B1-12`, `B1:12`, and `B1 12`. Spaces around a colon/hyphen are accepted. Runner codes start with a letter and may contain letters and numbers. Codes are displayed in uppercase. `B112` means runner B, part 112; use a separator for runner B1, part 12. Commas/newlines delimit entries; a runner and its space-separated number must be on the same line without a comma between them.

Unrecognised entries are highlighted and stay in the original input. Repeated parts remain separate entries, without quantity summaries. Blank section names display as “Untitled section.” Runner names use natural alphanumeric sorting; part numbers use numerical sorting. Equal references retain their original section/entry order.

## Files

- `dist/index.html`: accessible page structure and local asset loading.
- `dist/config.js`: deployment settings: the feedback access key, the optional Supabase address and public key, and the optional GoatCounter code.
- `dist/analytics.js`: cookieless visit and action counts (GoatCounter).
- `dist/styles.css`: light workshop layout, desktop/mobile breakpoints, and interface states.
- `dist/parts.js`: pure parser, sorting, section operations, project validation, and localStorage helpers.
- `dist/projects.js`: named project library, safe switching, duplicate-name protection, migration of the existing draft, and project file export/import.
- `dist/app.js`: editing controls, live cutting views, undo, and immediate browser saving.
- `dist/export.js`: A4 PDF layout, pagination, download naming, and Unicode name fallback.
- `dist/catalogue.js`: builds the kit catalogue from gunpla.fyi's data, and searches it.
- `dist/catalogue.json`: the generated catalogue (refresh with `node scripts/import-catalogue.mjs`).
- `dist/kit-picker.js`: kit-name suggestions on the workbench.
- `dist/cloud.js`: community helpers (kit details, title matching, sharing and "use this kit" copies) and the Supabase wrapper.
- `dist/community.js`: sign-in, cloud sync, the New project check, sharing, the Community kits pages and admin tools.
- `dist/privacy.html` / `dist/terms.html`: privacy policy and terms of use.
- `supabase/migrations/`: database tables, access rules, search and moderation functions.
- `docs/COMMUNITY-SETUP.md`: switching the community library on.
- `dist/vendor/pdf-lib.min.js` / `pdf-lib.LICENSE.md`: the bundled PDF library and its MIT license.
- `tests/parts.test.cjs`: dependency-free logic and storage tests.
- `tests/projects.test.cjs`: named saving, switching, snapshot isolation, migration, and storage tests.
- `tests/export.test.cjs`: PDF creation, A4 page sizes, pagination, preservation, and export validation tests.
- `tests/catalogue.test.cjs`: catalogue naming, grade and scale parsing, and search.
- `tests/cloud.test.cjs`: kit sharing, "use this kit", title matching and cloud-merge tests.
- `tests/sql/`: access-rule tests for the database, run against a throwaway local Postgres with `sh tests/sql/run.sh`.
- `tests/create-pdf-samples.cjs`: generates sample and stress-test PDFs for visual QA.
- `PRODUCT.md` / `DESIGN.md`: product and interface decisions.

The current draft and saved projects (including raw entry text, section order, and selected view) are stored together under `runner-notes.projects.v1` in localStorage. Draft edits save immediately; named snapshots update on Save, New, or Open. Existing data under `runner-notes.project.v1` migrates into the new draft automatically, leaving the old stored data untouched. A storage failure produces a visible warning; switching cannot discard current inputs when saving fails. No entered content is sent anywhere or interpreted as HTML. Scripts use ordinary deferred loading so opening the HTML directly does not need an ES-module server.

## Test

With Node.js installed:

```sh
node --test tests/*.test.cjs
```
