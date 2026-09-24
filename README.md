# RemoveWasteReminder

A React + Vite MVP for retail expiry control with advanced team management.

## Phase 1 Features
- Mobile-friendly dashboard
- Camera barcode scanning
- Product registration with barcode + expiry date
- "Remove today", overdue and next-7-days views
- Searchable product list
- Mark products as removed
- Browser notification permission
- LocalStorage persistence for the prototype
- Responsive sales-floor focused UI

## Phase 2 Features ✨
- **Advanced Filtering**: Filter products by status, category, and expiry range
- **CSV Export**: Managers can export product data (Excel/Google Sheets compatible)
- **Product Categories**: Organize products into categories with custom management
- **In-App Notifications**: Dashboard alerts for products needing removal
- **User Roles**: Staff and Manager roles with different permissions
- **Activity Tracking**: Complete audit trail with user actions, timestamps, and details

## Phase 3 Features ✨
- **Cloud Database**: Firebase Firestore integration for persistent data storage
- **Multi-User Access**: Email/Password authentication with user accounts
- **Real-Time Sync**: Live synchronization of products, categories, and activity logs across clients
- **Store/Branch Management**: Create and manage multiple store branches
- **Profile Management**: Update user profiles and sign out functionality
- **Activity Logs**: Cloud-backed audit trail per branch

## Phase 4 Features ✨ (NEW)
- **Staff Authentication**: Login using Staff Number and Phone Number (Firestore-backed)
- **Self-Registration**: Any team member can register with staff number, store, phone, email and password
- **Push Notifications**: Enable browser push notifications for urgent alerts
- **Daily Summary Alerts**: Configurable daily summaries at scheduled times
- **Custom Alert Settings**: Fine-tune alert preferences:
  - Alert lead time (how many days ahead to alert)
  - Escalation timing (automatic escalation after N hours)
  - Summary time configuration
- **Manager Escalation**: Staff can escalate issues to managers with messages
- **Private App Notice**: Startup notice confirming Woolworths-only access ("MADE WITH LOVE USING AI BY YOURDEVLEBO")
- **Two-Role System**: Staff and Manager roles with progressive permissions

## Phase 5 Features ✨ (Deployment & Error Checking)
- **Store Selection**: Registration uses a fixed store dropdown — `3156-Groblersdal` and `3138-Jean Crossing`
- **Email/Password Registration**: Staff number, store, phone, email and password captured at sign-up
- **Self-Registration**: No setup key — any team member can register and choose Staff or Manager
- **OTP Email Verification**: Firebase sends a verification link; accounts stay `pending` until confirmed
- **Staff-Number Sign-In**: Sign in with staff number + password only (no store or phone prompt)
- **Two-Role System**: Staff and Manager only
- **Store Attribution**: Every product records which store and which staff member saved it
- **Waste Removal History**: Full removal log in the Activity menu, visible to all roles
- **Store Analytics**: Waste performance per store — totals, on-time rate, overdue, value, by category and by staff
- **Profile Editing**: View and update display name, phone and email in Settings
- **Error Checking**: Firebase error codes are translated into readable messages for staff
## Data Model
```
staff/{storeCode}-{STAFFNO}    { staffNumber, storeCode, storeName, phoneNumber, email,
                                 role, status, authUid, settings, displayName }
stores/{storeCode}             { code, name, memberUids, categories }
  products/{productId}         { name, barcode, expiry, category, status,
                                 storeCode, storeName, createdByStaffNumber, createdByName }
  removals/{removalId}         { productId, productName, expiry, daysOverdue, wasteValue,
                                 storeCode, removedByStaffNumber, removedByName, removedAt }
  analyticsDaily/{YYYY-MM-DD}  { date, removedCount, wasteValue, byStaff }
  activity/{activityId}        { username, userId, action, details, createdAt }
  alerts/{alertId}             { message, from, type, status, createdAt }
  members/{staffNumber}        { staffNumber, storeCode, ...profile }
```

### Setup required in Firebase Console
1. **Authentication > Sign-in method**: enable **Email/Password**.
2. Deploy the rules and indexes:
   ```bash
   firebase deploy --only firestore
   ```

That is all — there is no setup key document to create.

## Run
Use Node 20 LTS (recommended) or 22 LTS. Avoid newer Node 24 builds on some Windows setups, which can trigger native libuv "UV_HANDLE_CLOSING" assertions during Vite startup.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Documentation
- **PHASE2_QUICK_START.md** - Quick guide for users
- **PHASE2_IMPLEMENTATION.md** - Technical documentation for developers
- **PHASE2_CHECKLIST.md** - Complete implementation verification
- **PHASE2_SUMMARY.md** - Project summary and statistics
- **PHASE3_IMPLEMENTATION.md** - Firebase integration and cloud features
- **PHASE4_IMPLEMENTATION.md** - Authentication, alerts, and escalation system

## User Roles

### Staff
- Scan and add products
- View all products with advanced filtering
- Mark products as removed
- Set personal name for tracking
- Receive alerts and notifications
- Escalate issues to managers

### Manager
- All staff capabilities, plus:
- Export products to CSV
- Manage product categories
- View complete activity log
- View store performance analytics
- Monitor user actions and patterns
- Receive escalation messages from staff
## Production Architecture
For a real store deployment:
1. ✅ Firebase/Firestore authentication and database (Phase 3-4)
2. ✅ Cloud data persistence across devices
3. Add Web Push/FCM reminders for closed-app notifications (scheduled alerts in progress)
4. ✅ Activity logs with cloud backend persistence
5. ✅ Multi-store support via branches
6. Add CSV import functionality
7. Add PWA install/offline support
8. ✅ Role-based permissions (staff/manager)

## Technology Stack
- React 19 with Hooks
- Vite 7 build tool
- html5-qrcode for barcode scanning
- lucide-react for icons
- LocalStorage for data persistence
- Pure CSS for styling (no frameworks)

## Browser Compatibility
- Chrome/Chromium: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Edge: ✅ Full support
- Mobile browsers: ✅ Full support (camera required for scanning)

## Notes
- Barcode scanning uses `html5-qrcode`, supporting common 1D/2D barcode formats
- Phase 1-2: LocalStorage for data persistence (browser-specific)
- Phase 3-4: Firebase Firestore for cloud persistence and real-time sync
- Requires Firebase project setup with Email/Password authentication enabled
- Staff sign in with Staff Number + password (verified by email OTP)
- No setup key required — registration is open to team members
- Notifications use browser Web Notification API (requires permission)
- Clear browser cache to reset local data (if not using Firebase)
- Multi-user deployments fully supported via Firebase branches
- Each store branch has independent product inventory and activity logs

## Build Status
✅ Production build successful (Phase 4)
- 0 compilation errors
- 0 console warnings
- Firebase integration verified
- All authentication workflows tested
- Ready for deployment

## Phase Implementation Timeline
- **Phase 1**: Core MVP - barcode scanning, product tracking
- **Phase 2**: Team management - filtering, CSV export, roles, activity tracking
- **Phase 3**: Cloud integration - Firebase Firestore, real-time sync, multi-branch
- **Phase 4**: Security & Alerts - staff authentication, admin registration, push notifications, custom alert settings, escalation system

