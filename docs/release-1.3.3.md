# Adminerva 1.3.3 — Restore the original school lesson format

Released 23 October 2026 (Asia/Manila).

## Changes

- Restores the school print table from before 1.3.1: merged session cells, original column proportions, Arial Narrow 10pt typography, black borders and blue `#b4c6e7` headings.
- Removes the newer measured text splitting, full-width session strips and repeated column-heading rows.
- Retains save-failure handling and print preparation feedback.
- Gives exported banner images explicit proportional dimensions. Google import no longer depends only on CSS maximum sizes.
- Applies export table styling directly and preserves borderless signature cells, account-bound authorization, clear export errors and Word/HTML downloads.
- Update notifications use recorded publication times. The confirmed deployment times for 1.3.1 and 1.3.2 are included; older date-only entries display a date without inventing a midnight time. New releases record a timestamp when their release metadata is published.

## Deployment and limits

This is a website-only patch; recovered teacher plans and stored lesson content are preserved. Source parsing and local dependency packaging checks are used. No runtime, browser or emulator test suites are run.

The screenshot of Google's editor error does not establish its cause. The patch corrects the generated document formatting, including the visibly oversized banner, without claiming control over Google editor, browser, network or account errors.
