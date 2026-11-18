# Adminerva Public Release Notes Standard

This document defines the default format for public Adminerva release notes beginning with 3.3.0.

## Purpose

Public release notes should explain verified shipped changes clearly to students, teachers and administrators without exposing private school, account, learner or operational data.

## Release structure

Use this order for significant releases:

1. **Release header**
   - Version
   - Release type
   - Release date
   - Short release title
   - One concise summary paragraph

2. **Topic summary**
   - 3–6 short topic chips derived from the strongest release themes.

3. **Release highlights**
   - Prefer 3–6 highlights.
   - Each highlight should include a title, concise summary and “Why this matters” statement.
   - Add relevant media when it materially helps explain the change.
   - A highlight without media must use a compact full-width layout rather than reserving blank media space.

4. **Full changelog**
   - Keep implementation-level detail available but secondary.
   - Collapse it by default for larger releases.
   - Group entries by product area.
   - Do not mix unfinished work into shipped changes.

5. **Still in development**
   - Use a dedicated development-only section.
   - State explicitly that these items are not included in the current release.
   - Do not count development items as released changes.

## Writing rules

- Lead with user outcomes rather than internal implementation language.
- Explain what changed, who benefits and why the change matters.
- Keep highlight text concise; place deeper technical detail in the changelog.
- Do not claim a capability is complete when it is still under validation.
- Use wording such as “foundation”, “preview”, “supported where available” or “under validation” when appropriate.
- Fix descriptions should explain the observable problem that was corrected without exposing private incident details.

## Public media rules

Release media must be suitable for a public page.

Before publication, review each screenshot for:
- names and email addresses
- account identifiers
- student identifiers
- submission, snapshot or private variant identifiers
- school-specific records that are not needed to explain the feature
- raw learner work when the release is demonstrating workflow rather than content
- private grading or evaluation material

Preferred handling order:
1. Crop irrelevant private areas.
2. Use a sanitized/demo screenshot when available.
3. Permanently obscure the minimum sensitive area required.
4. Use release-media redaction metadata as a display safety layer when a legacy screenshot cannot immediately be replaced.

Redactions must remain visible in both the inline preview and enlarged media viewer.

## Changelog categories

Use the smallest set that fits the release. Common groups are:
- Assessments & personalization
- Adminerva Studio
- Review, grade & evaluation
- School administration & navigation
- Fixes and reliability
- Other improvements

## Release readiness

Before publishing:
- Confirm the feature is actually shipped.
- Confirm the release date/version shown on the site is correct.
- Confirm highlights match the released behavior.
- Confirm development work is separated.
- Review public screenshots for sensitive data.
- Confirm the changelog is grouped and readable.
- Confirm release media has meaningful alt text and captions.
- Keep the public page usable on desktop and narrow/mobile layouts.

## Small patch releases

Patch releases use the same information hierarchy but may use fewer highlights and no media when visuals add little value. The standard is consistency, not forced length.

## Reference principle

> Adminerva release notes present verified shipped changes through concise editorial highlights, sanitized public media, grouped changelogs and a clearly separated still-in-development section.
