# Adminerva repository instructions

## Development model
- This repository is a static GitHub Pages frontend plus Firebase Functions/Firestore backend.
- The repository root intentionally has no Node dependency install.
- Backend dependencies live only in `functions/package.json` and `functions/package-lock.json`.

## Codex / local setup
- Do not commit `node_modules`, `.idea`, Firebase emulator state, or generated logs.
- When backend dependencies are needed, run `cd functions && npm ci`.
- Preserve `functions/package-lock.json`; it is the reproducible dependency contract for Codex, CI and Firebase deployment.
- Prefer focused checks for the files/workflows changed. Avoid broad repetitive test runs unless a release gate or security change requires them.

## Release and deployment
- GitHub Pages deploys from `main`.
- Firebase Functions and Firestore indexes are a separate deployment. Use the repository Firebase deployment workflow after its production service-account secret is configured, or run the Firebase CLI manually.
- Do not mark a release public in `patch-history.json` or advance `site-release.json` until required backend deployment is complete.
- Keep notification badge assets separate from website/PWA branding assets.

## UI conventions
- Use the shared `css/adminerva-ui.css`, shared navigation and loader rather than page-specific copies.
- Preserve role-aware routing and section-scoped authorization.
- New controls should be keyboard reachable, use visible focus, and remain usable at 320px-wide mobile layouts.
- Avoid adding duplicate teacher workflows when an existing integrated Review & Grade, Gradebook, Repository Management or Lesson Planning surface can host the action.
