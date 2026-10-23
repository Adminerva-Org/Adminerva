# Adminerva 1.3.1 — Lesson export patch

Released 23 October 2026 (Asia/Manila). Includes the deployed 1.3.0 teaching and learning changes.

## Visible changes

- Lesson-plan printing uses landscape pages with repeating column headers and continuous bounded rows. Session-wide rowspans no longer force short tails onto mostly empty continuation pages. Full lesson content, asynchronous sessions and signatures remain included.
- Google Docs export reuses an unexpired Google Drive permission in page memory for the same signed-in account. It uploads UTF-8 HTML directly, without requiring the Word download library.
- Export errors include Google response details and HTTP status. A document created before a formatting error retains its Open Google Doc link. Word and HTML downloads remain available.
- Browser-generated print headers and footers can be disabled in the browser print dialog using the nearby print guidance.

## Deployment and checks

- Google Drive and Docs APIs were confirmed enabled in the existing project. No Firebase configuration replacement was needed.
- Only source parsing and local dependency packaging checks were run. No runtime, browser or emulator tests were added or run, as requested.
- Google account consent, popup restrictions and Workspace policy still apply. If Google rejects export, the displayed details identify the required action; no unverified end-to-end export success is claimed.
