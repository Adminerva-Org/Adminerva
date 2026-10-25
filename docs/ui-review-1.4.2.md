# UI/UX shell review — 1.4.2 maintenance

Scope: all root HTML entry points plus the shared navigation, shared UI stylesheet, PWA manifest and role guards.

## Findings resolved

- Shared UI/navigation cache revisions were inconsistent across student, teacher, administrator, guest and compatibility pages. Root pages now load the same 1.4.2 shared shell where applicable.
- Staff Settings and Administration Analytics did not use the centralized page admission guard. They now stay hidden until verified access completes.
- Installed Adminerva launched directly into Student Home. The PWA now starts at the role-neutral public entry and can route users into the appropriate workspace.
- Apple/home-screen branding reused the notification badge. Website/PWA branding now uses a dedicated Adminerva badge; the notification badge remains notification-specific.
- Legacy redirect pages lacked mobile viewport metadata. Compatibility URLs remain lightweight but are mobile-safe.
- The Practice Analytics redirect now preserves incoming query context while routing to the consolidated analytics view.
- Shared focus visibility, mobile form sizing, touch-target sizing and long-content containment are normalized in the global stylesheet.
- Staff settings replaced implementation-heavy AI wording with system/content-assistance language.

## Deliberately unchanged

- Existing integrated teacher workflows remain the primary destinations; no duplicate review/grading pages were introduced.
- Guest pages remain unauthenticated and keep their existing public-tool behavior.
- Historical redirect URLs are retained for bookmarks and old notifications.
- Dense specialized workspaces such as Playground keep their purpose-built layout instead of inheriting generic page spacing.

## Follow-up

A real-device pass is still useful after deployment for iOS installed-app icon appearance, small-screen Playground ergonomics and browser-specific notification permission UI. Those checks should validate appearance only; they do not require another broad functional test cycle.
