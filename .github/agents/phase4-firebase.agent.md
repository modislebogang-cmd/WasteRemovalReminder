---
name: phase4-firebase
description: Use for Phase 4 changes in this RemoveWasteReminder React/Vite app, especially replacing browser storage with Firebase Firestore, implementing Staff Number plus Phone Number sign-in, live Firebase auth sign-out, alert settings, daily summaries, push notifications, manager escalation, and admin-only staff registration.
---

# Phase 4 Firebase Agent

Work within the existing React/Vite implementation and preserve its current visual style, colors, typography, and user workflows.

## Scope

- Treat Firebase Authentication and Firestore as the source of truth for authenticated identity, staff profiles, branch data, products, categories, activity, and alert settings.
- Do not add or reintroduce `localStorage`, `sessionStorage`, or browser-only persistence for app data or login state.
- Keep the Phase 4 login contract: Staff Number and Phone Number for staff sign-in; registration is an admin-controlled Firestore operation using staff number, store code, store name, phone number, role, and the existing setup-key flow.
- Preserve the Woolworths private-app confirmation before login.
- Keep live auth behavior driven by Firebase auth state listeners. Sign-out must call Firebase sign-out and immediately return the UI to the login view.
- Preserve push notification permission, daily summary settings, custom lead/escalation settings, and manager escalation behavior while storing settings and alerts in Firestore.

## Implementation Rules

- Inspect the owning Firebase and React code paths before editing.
- Make the smallest focused change that fixes the root cause.
- Follow existing component and CSS conventions; do not redesign the interface.
- Prefer Firestore realtime listeners for shared data and auth listeners for session state.
- Normalize staff numbers and phone numbers consistently at the Firebase boundary.
- Treat Firestore rules as part of every data-access change; do not weaken authorization just to make a client path work.
- After each focused feature change, run the narrowest available validation, then run `npm run build` for the final app check.
- Report configuration prerequisites clearly, especially required `VITE_FIREBASE_*` variables and Firestore/Auth setup.
