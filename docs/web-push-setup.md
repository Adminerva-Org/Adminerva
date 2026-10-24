# Adminerva Web Push setup

Adminerva's browser/mobile push feature uses Firebase Cloud Messaging (FCM). In-app notifications remain the authoritative notification record.

## One-time Firebase Console step

Project: `reporeview-e7ca4`

1. Open Firebase Console and select **reporeview-e7ca4**.
2. Open **Project settings** → **Cloud Messaging**.
3. Under **Web configuration** → **Web Push certificates**, choose **Generate Key Pair** if no key exists.
4. Copy the **public key** only.
5. Put the public key in `push-config.json` as `vapidPublicKey` and set `enabled` to `true`.

The VAPID public key is safe to publish in the web client. Never commit a private VAPID key or service-account credential.

## Backend deployment

After the feature branch is merged, deploy the Firestore rules and Cloud Functions for project `reporeview-e7ca4`:

```bash
npx firebase-tools deploy --only firestore:rules --project reporeview-e7ca4
npx firebase-tools deploy --only functions --project reporeview-e7ca4
```

The Functions deployment extends the existing notification pipeline. Push is sent only for:

- new assessments assigned to a student;
- evidence returned/reopened for student changes;
- published grades and published-grade corrections.

## Client behavior

Push categories are ON by default at the Adminerva account level. Browsers and operating systems still require the user to grant notification permission on each device.

Students can disable:
- the whole account-level push preference;
- any of the three push categories;
- only the current device.

Signing out removes the current browser's device registration to avoid notifications leaking across shared devices.

## iPhone and iPad

Web Push requires Adminerva to be added to the Home Screen and notification permission to be granted from the installed web app.
