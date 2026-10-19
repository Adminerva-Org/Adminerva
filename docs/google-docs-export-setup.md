# Google Docs export connection

Lesson Planner uses Google Identity Services to authorize an individual teacher's export. This is separate from Firebase sign-in. The public web client ID configured in `js/lesson-review/document-exporter.js` is:

`902176956124-i9vcin925le0d9jghr4afn56q7n53gl5.apps.googleusercontent.com`

The owner supplied this existing Adminerva client and confirmed that `https://adminerva-org.github.io` is already in its authorized JavaScript origins. The previous export referenced a different project's client. No client secret belongs in browser code, the repository or support screenshots.

## Console prerequisites

1. Open the existing Web application client in Google Cloud's Google Auth Platform → Clients. Keep all existing Firebase redirect settings and approved origins. The live JavaScript origin is exactly `https://adminerva-org.github.io`, with no `/Adminerva/` path.
2. In project `reporeview-e7ca4`, enable both Google Drive API and Google Docs API. Export uploads a new document through Drive, then reads and formats that same document through Docs.
3. Ensure the consent screen/audience allows the intended accounts. If the app is in testing, eligible testers may need to be explicitly configured. Workspace administrators can impose additional restrictions. Do not bypass Google consent or organization policy.
4. Save the lesson, refresh Lesson Planner and choose Export to Google Docs. Grant the requested file permission only if you intend to export.

The app requests only `https://www.googleapis.com/auth/drive.file` and does not include earlier granted scopes in this export token. Google supports this scope for Drive upload and Docs read/update on app-created files; it does not require access to all of the teacher's documents. Tokens remain in memory and are not stored in Firestore or browser storage by the export flow. No Google session, document or production account is created by automated tests.

## Verification and limitations

Regression tests execute the real export entry point in an isolated JavaScript context with synthetic Google token callbacks and mocked Drive/Docs responses. They cover client selection, least-privilege scopes, declined/missing consent, blocked/closed popups, preparation failure, successful formatting and upload failures. They cannot establish that Cloud Console services/audience are configured or that real Google consent succeeds. Those require a deliberate owner test after deployment. If upload created a document but inspection/formatting fails, the existing warning offers manual inspection instead of claiming success or deleting the document.

This change does not edit Firebase Auth providers, permission rules, Functions, submissions or grades. Keep the auto-created OAuth client; do not delete or recreate it just to configure export.

References: [Origin mismatch](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#origin_mismatch), [enable Workspace APIs](https://developers.google.com/workspace/guides/enable-apis), [Docs API scopes](https://developers.google.com/workspace/docs/api/auth), [token callbacks](https://developers.google.com/identity/oauth2/web/reference/js-reference).
