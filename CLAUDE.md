# Cap Toc (IELTS Blitz) — CLAUDE.md
**Slug:** cap_toc / ielts_blitz
**Stack:** Vanilla JS + HTML/CSS — no framework, no build step. Just open `index.html`.
**Live:** https://thevoidest.github.io/Project-IELTS-CAP-TOC/ (GH Pages, source = `main`)
**Repo:** https://github.com/Thevoidest/Project-IELTS-CAP-TOC

> Inherits Band 9 + C2 register from `../CLAUDE.md`. Discipline rules from sibling `Project Read Lis/CLAUDE.md` do **NOT** apply here (no /ship, no version bump, no preview-first, no Vercel push).

---

## Files
| File | Purpose |
|---|---|
| `index.html` | single-page entry, loads CSS + JS |
| `style.css` | visual |
| `app.js` | app logic + SRS engine + quiz dispatcher (~1.3k lines) |
| `data.js` | `const VOCAB_DATA = { cambridge: {13–19: {1–4: {word:{}}}}, roadToIelts: {...} }` |
| `_mockups/` | design refs — not deployed |

## Data shape — every word entry
```js
"word-or-phrase": { section, meaning, type, collocation, example, connotation, [antonym] }
```
- `section`: `"reading"` | `"listening"`
- `type`: `noun` | `verb` | `adjective` | `adverb` | `phrase`
- `connotation`: `positive` | `neutral` | `negative`
- `meaning` is mandatory — entries without it are silently skipped (`app.js:530`)
- `antonym` is optional; only add when the contrast is unambiguous

## SRS scoping (v2)
- localStorage key: `` `${sessionId}::${word}` `` e.g. `c14t4::thriving`
- `sessionId` auto-derived in `app.js:418` as `` `c${vol}t${t}` `` — no manual wire
- `migrateSRSv1()` runs on boot, converts old plain-word keys → scoped keys

## Branch + deploy convention
- `master` = active dev branch — push freely
- `main` = GH Pages source — fast-forward from master when ready to ship
- Deploy command: `git push origin master:main`
- Pages rebuild ~1–2 min after push

## Adding a Cambridge test (recipe)
1. **Source DOCX** lives in IELTS Platform repo root (e.g. `../Project Read Lis/IELTS_Vocab_Cam16_C1.docx`). User bolds 1–2 word keys, fills VN, uses `||` to split 2 keys/row.
2. **Parse**: r_idx (table position) ≠ cells[0].text (user's manual `#` — gaps where rows deleted). Always look up by r_idx.
3. **Pair flat**: split phrase on `||` → bold spans; split nghĩa on `||`. If counts match, pair 1:1; else fall back to seg-pairing.
4. **Enrich** (per entry): `type` (POS) + `collocation` (3–5 word natural form) + `example` (8–15 word Cambridge-register sentence) + `connotation`. Match Cam 14 Test 4 quality.
5. **Patch** `data.js`: replace `N: { 1:{}, 2:{}, 3:{}, 4:{} },` with populated bucket. Use `assert content.count(OLD) == 1` before `str.replace()`.
6. **Validate**: `node --check data.js` → eval-load → count entries per test.
7. **Push**: `git push origin master:main` to deploy.

## What NOT to do
- ❌ Don't change SRS key format — student localStorage state is pinned to `c{vol}t{N}::word`
- ❌ Don't bundle/minify — manual edits + readable git diff is the workflow
- ❌ Don't add React/Vue/build step — defeats zero-config simplicity
- ❌ Don't hardcode large data blobs in fix scripts — write to file once, reference everywhere
