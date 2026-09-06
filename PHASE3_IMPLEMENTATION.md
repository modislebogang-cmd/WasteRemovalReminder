# Phase 3 Implementation

Phase 3 adds Firebase-backed collaboration while preserving the existing localStorage fallback.

## Features

- **Cloud database**: Firebase Firestore stores branch products, categories, and activity records.
- **Multi-user access**: Firebase Email/Password Authentication supports separate user accounts.
- **Real-time sync**: Firestore `onSnapshot` listeners update products, categories, and activity logs across open clients.
- **Store / branch management**: Users can create a branch and select branches they belong to.
- **Activity logs**: Product changes, role changes, profile updates, and CSV exports are stored per branch.
- **Profile management**: Users can update their Firebase display name and sign out from Settings.

## Setup

1. Create a Firebase project and enable Email/Password Authentication and Cloud Firestore.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app values.
3. Deploy `firestore.rules` to the project.
4. Run `npm install` and `npm run dev`.

Without Firebase environment variables, the app continues to use the Phase 2 localStorage behavior. This keeps local development and existing browser data available until a Firebase project is configured.

## Branch membership

A branch is created with its owner's Firebase UID in `memberIds`. To share a branch, add another authenticated user's UID to that array using a trusted Firebase Admin workflow or the Firebase console. The included rules restrict branch reads and writes to members.

## Validation

`npm run build` passes. Vite reports only the existing bundle-size warning caused by including Firebase and barcode-scanning dependencies.
