# Firebase deployment

GitHub Pages and Firebase are separate Adminerva deployment surfaces.

## One-time GitHub setup
Create a Firebase/Google Cloud service account that can deploy the Adminerva Functions and Firestore indexes for project `reporeview-e7ca4`. Store its JSON credential in the repository Actions secret:

`FIREBASE_SERVICE_ACCOUNT_REPOREVIEW_E7CA4`

Do not commit the JSON file.

## Normal deployment
For the first deployment, use **Actions → Firebase backend deployment → Run workflow** after the credential is configured. To enable automatic deployment for later backend changes, add the repository Actions variable `FIREBASE_DEPLOY_ENABLED=true`.

The workflow:
1. checks out the repository,
2. installs the exact backend dependency tree with `npm ci --prefix functions`,
3. writes the service-account JSON only to the temporary GitHub runner,
4. deploys `firestore:rules,firestore:indexes,functions`.

GitHub Pages continues to deploy separately from `main`.

## Release ordering
For releases containing backend, rule or index changes:
1. merge source,
2. deploy Firebase backend/indexes,
3. confirm GitHub Pages,
4. advance `site-release.json` and make the matching patch-history record public,
5. optionally send the release push announcement.

This ordering prevents the frontend from advertising backend behavior that has not been deployed yet.
