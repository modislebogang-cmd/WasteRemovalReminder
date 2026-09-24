/**
 * One-time setup helper for the registration setup key.
 *
 * The app validates the admin setup key against a Firestore document at
 * `config/registration` before it will create a staff account. That document
 * must be created out-of-band, because the client rules forbid writing it.
 *
 * This script does NOT talk to Firebase itself (that needs credentials this
 * repo does not hold). It prints the exact document to create. Pass the key you
 * want to use:
 *
 *   node scripts/seed-registration-key.mjs "YOUR-SECRET-KEY"
 *
 * Then create the document in the Firebase Console as printed, and deploy the
 * rules:
 *
 *   firebase deploy --only firestore
 */

const setupKey = (process.argv[2] || "").trim();

if (setupKey.length < 4) {
  console.error("Provide a setup key of at least 4 characters:");
  console.error('  node scripts/seed-registration-key.mjs "YOUR-SECRET-KEY"');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || "waste-627ab";

console.log(`
Registration setup key helper
=============================

Project:      ${projectId}

Create this Firestore document:

  Collection:   config
  Document ID:  registration
  Field:        setupKey   (string)
  Value:        ${setupKey}

Console shortcut:
  https://console.firebase.google.com/project/${projectId}/firestore

Then deploy the rules and indexes:

  firebase deploy --only firestore

Checklist before registering a staff member:
  [ ] config/registration exists with the setupKey above
  [ ] Authentication > Sign-in method > Email/Password is ENABLED
  [ ] firestore.rules has been deployed (firebase deploy --only firestore)

Note: the setup key is readable by anyone who can reach the app (registration
happens before the user has an account, so the read cannot require auth). Treat
it as a soft gate, not a secret that protects sensitive data. Rotate it by
editing the document if it leaks.
`);
