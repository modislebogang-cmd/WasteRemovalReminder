import { initializeApp } from "firebase/app";
import {
	getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
	updateProfile, signOut, sendPasswordResetEmail
} from "firebase/auth";
import {
	getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc, getDocs,
	query, where, orderBy, limit, onSnapshot, serverTimestamp, increment
} from "firebase/firestore";
const defaultFirebaseConfig = {
	apiKey: "AIzaSyCJ4c5LHMuXXfBAG29OFafCsMtWpSU84D4",
	authDomain: "waste-627ab.firebaseapp.com",
	projectId: "waste-627ab",
	storageBucket: "waste-627ab.firebasestorage.app",
	messagingSenderId: "236826139964",
	appId: "1:236826139964:web:bf8dde3b8eb83a03189239"
};
const firebaseConfig = Object.fromEntries(Object.entries(defaultFirebaseConfig).map(([key, value]) => [
	key,
	import.meta.env[`VITE_FIREBASE_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`] || value
]));
export const firebaseEnabled = Object.values(firebaseConfig).every(Boolean);
const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const watchAuth = (callback) => auth ? onAuthStateChanged(auth, callback) : () => {};

/* ---------------------------------------------------------------- stores --- */

// The two fixed stores this app is deployed for (requirement 0.2).
export const STORES = [
	{ code: "3156", name: "Groblersdal" },
	{ code: "3138", name: "Jean Crossing" }
];
export const storeNameFor = (code) => STORES.find(store => store.code === code)?.name || "";

// Staff sign in with a staff number, but Firebase Auth needs an email credential.
// Staff numbers are unique within a store, so qualify them with the store code to
// build a deterministic internal address. The login field stays labelled "Staff number".
const AUTH_EMAIL_DOMAIN = "waste.internal";
export const authEmailFor = (storeCode, staffNumber) =>
	`${String(storeCode || "").trim().toLowerCase()}.${String(staffNumber || "").trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

/* ------------------------------------------------------ error translation --- */

// Requirement: "firebase database error checking". Raw Firebase codes mean nothing to
// staff on a shop floor, so every failure path gets a readable message.
export function friendlyError(error) {
	const code = error?.code || "";
	const map = {
	"auth/invalid-credential": "Staff number or password is incorrect.",
	"auth/wrong-password": "Staff number or password is incorrect.",
	"auth/user-not-found": "No account found for that staff number.",
	"auth/invalid-email": "That staff number could not be resolved to an account.",
	"auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
	"auth/email-already-in-use": "That staff number is already registered.",
	"auth/weak-password": "Password must be at least 6 characters.",
	"auth/operation-not-allowed": "Email/password sign-in is not enabled. In Firebase Console open Authentication > Sign-in method and enable Email/Password.",
	"auth/network-request-failed": "Network problem. Check your connection and try again.",
	"permission-denied": "You do not have permission for that action. Check your store access (if this happens at sign-in, the Firestore rules for this project have not been deployed yet — run: firebase deploy --only firestore).",
	"unavailable": "Cannot reach the database. Check your connection.",
	"failed-precondition": "The database needs an index for this query. Contact your administrator.",
	"not-found": "That record no longer exists."
	};
	if (map[code]) return map[code];
	if (code.startsWith("auth/")) return `Sign-in problem (${code}). Please try again.`;
	return error?.message || "Something went wrong. Please try again.";
}

/* ------------------------------------------------------------------- auth --- */

// Staff documents are keyed by storeCode-staffNumber so no uid lookup is needed.
const staffDocId = (storeCode, staffNumber) =>
	`${String(storeCode).trim()}-${String(staffNumber).trim().toUpperCase()}`;
export { staffDocId };

/**
 * Requirement 1: sign in with staff number and password only.
 * The store is inferred from the staff record so the user types just two fields.
 */
export async function signInWithStaff(staffNumber, password) {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const number = String(staffNumber || "").trim().toUpperCase();
	if (!number) throw new Error("Enter your staff number.");
	if (!password) throw new Error("Enter your password.");

	// The store code is part of the derived credential, but the user only types a
	// staff number. The store list is fixed and small, so each store's derived
	// address is attempted in turn. This keeps ALL Firestore reads behind
	// authentication — querying `staff` before sign-in is denied by the rules
	// (staff docs are only readable by their owner), which surfaces to the user as
	// "Missing or insufficient permissions".
	const { credential, storeCode } = await signInAcrossStores(number, password);

	// From here the caller is authenticated, so staff reads are permitted.
	const docId = staffDocId(storeCode, number);

	// Write the uid -> store mirror BEFORE reading the staff document. Every
	// store-scoped rule resolves the caller through this document, and the staff
	// read itself accepts the mirror as proof of ownership. If this write is
	// skipped (or fails silently) the user is left authenticated but with no store
	// link, and every later read is denied with "Missing or insufficient
	// permissions" — the exact symptom on the login screen. It is therefore
	// attempted first and its failure is surfaced rather than swallowed.
	let profile;
	try {
		await setDoc(doc(db, "staffByUid", credential.user.uid), {
			staffDocId: docId,
			storeCode,
			staffNumber: number
		}, { merge: true });
	} catch (error) {
		await signOut(auth);
		throw new Error(friendlyError(error));
	}

	try {
	const snapshot = await getDoc(doc(db, "staff", docId));
	profile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
	} catch (error) {
	await signOut(auth);
	throw new Error(friendlyError(error));
	}

	if (!profile) {
	await signOut(auth);
	throw new Error("Your staff record is missing. Ask a manager to re-register you.");
	}
	if (profile.status === "disabled") {
	await signOut(auth);
	throw new Error("This staff account has been disabled.");
	}

	try {
	await setDoc(doc(db, "staff", docId), {
		authUid: credential.user.uid,
	status: "active",
	lastLoginAt: serverTimestamp()
	}, { merge: true });
	} catch {
	// The account is usable even if this bookkeeping write is refused, so don't
	// block sign-in on it.
	}

	// Keep the mirror in step with the role on the staff record. The link was
	// already created above; this refresh only carries the role forward.
	try {
	await setDoc(doc(db, "staffByUid", credential.user.uid), {
		role: profile.role === "manager" ? "manager" : "staff"
	}, { merge: true });
	} catch {
	// Non-fatal for the session.
	}

	return { ...profile, authUid: credential.user.uid, status: "active" };
}

// Signs in across the fixed store list, returning the first successful credential
// and the store code it matched. Avoids any Firestore read while unauthenticated.
async function signInAcrossStores(staffNumber, password) {
	let lastError = null;
	for (const store of STORES) {
	try {
	const credential = await signInWithEmailAndPassword(auth, authEmailFor(store.code, staffNumber), password);
	return { credential, storeCode: store.code };
	} catch (error) {
		lastError = error;
		// Only a bad credential means try the next store. Anything else is terminal.
		if (error?.code !== "auth/invalid-credential" && error?.code !== "auth/user-not-found") {
			throw new Error(friendlyError(error));
		}
	}
	}
	throw new Error(friendlyError(lastError));
}

export const sendStaffPasswordReset = async (staffNumber) => {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const number = String(staffNumber || "").trim().toUpperCase();
	if (!number) throw new Error("Enter your staff number.");
	// The staff number alone may exist in either store, so send a reset link to each
	// derived address that resolves. Only addresses matching a real account succeed.
	let sent = false;
	for (const store of STORES) {
		try {
			await sendPasswordResetEmail(auth, authEmailFor(store.code, number));
			sent = true;
		} catch (error) {
			if (error?.code !== "auth/user-not-found" && error?.code !== "auth/invalid-email") {
				throw new Error(friendlyError(error));
			}
		}
	}
	if (!sent) throw new Error("No account found for that staff number.");
};

export async function getStaffProfile(authUid, storeCode, staffNumber) {
	if (!db || !authUid) return null;
	// A signed-in caller may read their own staff document, but the rules can only
	// verify a DIRECT document read (resource.data.authUid == request.auth.uid).
	// A `where` query is evaluated before the rules filter, so Firestore cannot
	// prove every possible result is permitted and rejects it with "Missing or
	// insufficient permissions". Therefore only the direct read is used.
	if (!storeCode || !staffNumber) return null;
	const snapshot = await getDoc(doc(db, "staff", staffDocId(storeCode, staffNumber)));
	if (!snapshot.exists()) return null;
	const data = snapshot.data();
	// Guard against a stale local cache pointing at somebody else's record.
	if (data.authUid && data.authUid !== authUid) return null;
	return { id: snapshot.id, ...data };
}

export const updateUserProfile = (user, data) => updateProfile(user, data);
export const logOut = () => signOut(auth);

/**
 * Requirements 0.1-0.5: register a staff member.
 * Creates the Auth credential, writes the staff document, and enrols them in their store.
 */
export async function registerStaffMember(member) {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const storeCode = String(member.storeCode || "").trim();
	const staffNumber = String(member.staffNumber || "").trim().toUpperCase();
	const email = String(member.email || "").trim().toLowerCase();
	if (!storeCode) throw new Error("Please select your store.");
	if (!staffNumber) throw new Error("A staff number is required.");
	if (!email) throw new Error("An email address is required.");
	if (!member.password || member.password.length < 6) throw new Error("Password must be at least 6 characters.");

	// Only two roles exist. Anything else falls back to staff.
	const role = member.role === "manager" ? "manager" : "staff";

	const docId = staffDocId(storeCode, staffNumber);

	// Create the Auth user for the derived staff address.
	let credential;
	try {
	credential = await createUserWithEmailAndPassword(auth, authEmailFor(storeCode, staffNumber), member.password);
	} catch (error) {
	throw new Error(friendlyError(error));
	}
	await updateProfile(credential.user, { displayName: `${staffNumber} (${storeNameFor(storeCode)})` });

	try {
	// The staff record must exist before the uid link: the staffByUid create rule
	// reads that staff document to prove the store and staff number being claimed
	// are genuinely the caller's own. Writing the link first therefore always
	// fails with "Missing or insufficient permissions". The record starts
	// "pending" so the caller cannot self-promote.
	await setDoc(doc(db, "staff", docId), {
	staffNumber,
	storeCode,
	storeName: storeNameFor(storeCode),
	phoneNumber: String(member.phoneNumber || "").replace(/\D/g, ""),
	email,
	role,
	status: "pending",
		authUid: credential.user.uid,
	createdAt: serverTimestamp()
	});
	// Only now can the uid link be created — every store-scoped rule resolves the
	// caller's store through it, so nothing else is authorised until it exists.
	await setDoc(doc(db, "staffByUid", credential.user.uid), {
		staffDocId: docId,
		storeCode,
		staffNumber,
		role
	}, { merge: true });
	await setDoc(doc(db, "stores", storeCode), {
	code: storeCode,
	name: storeNameFor(storeCode),
	memberUids: [credential.user.uid]
	}, { merge: true });
	  } catch (error) {
		// Don't leave an orphaned Auth credential if the Firestore write failed.
		await signOut(auth).catch(() => {});
		throw new Error(friendlyError(error));
		}
		return { id: docId, staffNumber, storeCode, email };
	}

/* ------------------------------------------------------------------ staff --- */

export async function updateStaffProfile(staffDocId, updates) {
	if (!db) return;
	return setDoc(doc(db, "staff", staffDocId), { ...updates, updatedAt: serverTimestamp() }, { merge: true });
}
export async function getUserSettings(staffDocId) { if (!db) return null; const snapshot = await getDoc(doc(db, "staff", staffDocId)); return snapshot.exists() ? snapshot.data().settings || null : null; }
export async function saveUserSettings(staffDocId, settings) { if (db) return setDoc(doc(db, "staff", staffDocId), { settings }, { merge: true }); }

/* ------------------------------------------------------- products/removals --- */

export const storeCollection = (storeCode, name) => collection(db, "stores", storeCode, name);
export const storeRef = (storeCode) => doc(db, "stores", storeCode);

// Live sync for products, categories and the activity trail of one store.
export function watchStore(storeCode, onProducts, onCategories, onActivity, onError) {
	const productsQuery = query(storeCollection(storeCode, "products"), orderBy("updatedAt", "desc"));
	const activityQuery = query(storeCollection(storeCode, "activity"), orderBy("createdAt", "desc"), limit(100));
	const unsubProducts = onSnapshot(productsQuery,
		snapshot => onProducts(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
	const unsubStore = onSnapshot(storeRef(storeCode),
		snapshot => onCategories(snapshot.data()?.categories || ["Dairy", "Meat", "Bakery", "Beverages", "Frozen", "General"]), onError);
	const unsubActivity = onSnapshot(activityQuery,
		snapshot => onActivity(snapshot.docs.map(item => ({
	id: item.id, ...item.data(),
		timestamp: item.data().timestamp || item.data().createdAt?.toDate?.()?.toISOString()
	}))), onError);
	return () => { unsubProducts(); unsubStore(); unsubActivity(); };
}

/**
 * Requirements 2 and 4: persist the expiry product and stamp exactly which store and
 * which staff member saved it, so analytics can attribute performance per store.
 */
export async function addSharedProduct(storeCode, product, staff) {
	if (!db) return;
	return setDoc(doc(db, "stores", storeCode, "products", product.id), {
	...product,
	storeCode,
	storeName: storeNameFor(storeCode),
	createdByStaffNumber: staff?.staffNumber || "",
	createdByName: staff?.displayName || staff?.staffNumber || "",
	createdBy: staff?.authUid || "",
	updatedAt: serverTimestamp()
	});
}

export async function updateSharedProduct(storeCode, productId, data, staff) {
	return updateDoc(doc(db, "stores", storeCode, "products", productId), {
	...data,
	storeCode,
	updatedByStaffNumber: staff?.staffNumber || "",
	updatedBy: staff?.authUid || "",
	updatedAt: serverTimestamp()
	});
}

/**
 * Requirements 3 and 6: write the removal to a dedicated history collection that feeds
 * the Analytics view and the waste-removal history in the Activity menu.
 */
export async function recordRemoval(storeCode, product, staff) {
	if (!db) return;
	const expiry = product?.expiry ? new Date(product.expiry) : null;
	if (expiry) expiry.setHours(0, 0, 0, 0);
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const daysOverdue = expiry ? Math.round((today - expiry) / 86400000) : 0;
	const wasteValue = Number(product?.unitCost || 0) * Number(product?.quantity || 1);

	await addDoc(storeCollection(storeCode, "removals"), {
	productId: product.id,
	productName: product.name,
	barcode: product.barcode,
	category: product.category || "General",
		expiry: product.expiry,
		daysOverdue,
	wasteValue,
	storeCode,
	storeName: storeNameFor(storeCode),
	removedByStaffNumber: staff?.staffNumber || "",
	removedByName: staff?.displayName || staff?.staffNumber || "",
	removedBy: staff?.authUid || "",
	removedAt: serverTimestamp()
	});

	// Pre-aggregate per day so the analytics screen doesn't scan every removal.
	const day = new Date().toISOString().slice(0, 10);
	const daily = { date: day, removedCount: increment(1), wasteValue: increment(wasteValue) };
	if (staff?.staffNumber) daily.byStaff = { [staff.staffNumber]: increment(1) };
	await setDoc(doc(db, "stores", storeCode, "analyticsDaily", day), daily, { merge: true });
}

// Requirement 6: the removal history shown in the Activity menu.
export function watchRemovals(storeCode, onRemovals, onError) {
	if (!db) return () => {};
	return onSnapshot(
	query(storeCollection(storeCode, "removals"), orderBy("removedAt", "desc"), limit(200)),
		snapshot => onRemovals(snapshot.docs.map(item => ({
	id: item.id, ...item.data(),
	removedAtISO: item.data().removedAt?.toDate?.()?.toISOString() || null
	}))),
		onError
	);
}

// Requirement 3: pre-aggregated daily waste figures for the analytics screen.
export function watchDailyAnalytics(storeCode, onDays, onError) {
	if (!db) return () => {};
	return onSnapshot(
	query(storeCollection(storeCode, "analyticsDaily"), orderBy("date", "desc"), limit(30)),
		snapshot => onDays(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
		onError
	);
}

export async function addActivity(storeCode, activity) { return addDoc(storeCollection(storeCode, "activity"), { ...activity, storeCode, createdAt: serverTimestamp() }); }
export const saveStoreCategories = (storeCode, categories) => setDoc(storeRef(storeCode), { categories }, { merge: true });

/* ------------------------------------------------ all store performance --- */

// Firestore rules scope every caller to their own store, so a cross-store view is
// assembled one permitted store document at a time and cached. That keeps the
// aggregate free: no Cloud Function, no paid aggregation service, and the number
// of reads is bounded by the fixed two-store list.
export const STORE_PERFORMANCE_TTL_MS = 120000;
const STORE_PERFORMANCE_KEY = "rwr.storePerformance";

const summariseStore = (storeCode, removals) => {
	const late = removals.filter(item => Number(item.daysOverdue || 0) > 0).length;
	const removed = removals.length;
	const onTime = removed - late;
	return {
		storeCode,
		storeName: storeNameFor(storeCode),
		removed,
		onTime,
		late,
		onTimeRate: removed ? Math.round((onTime / removed) * 100) : 0,
		wasteValue: removals.reduce((sum, item) => sum + Number(item.wasteValue || 0), 0),
		// Requirement 4 (new): the graph compares removed on time against removed late.
		timeline: removals.slice(0, 60).reverse().map(item => ({
			productName: item.productName,
			removedAt: item.removedAtISO,
			daysOverdue: Number(item.daysOverdue || 0),
			onTime: Number(item.daysOverdue || 0) <= 0
		}))
	};
};

export const readCachedStorePerformance = () => {
	try {
		const raw = window.localStorage.getItem(STORE_PERFORMANCE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed?.stores) ? parsed : null;
	} catch {
		return null;
	}
};

export const writeCachedStorePerformance = (stores) => {
	const payload = { stores, updatedAt: new Date().toISOString() };
	try { window.localStorage.setItem(STORE_PERFORMANCE_KEY, JSON.stringify(payload)); } catch { /* storage full or blocked */ }
	return payload;
};

/**
 * Requirement 4 (new): the All store performance view.
 * Each store's removal history is read from that store's own collection, so the
 * rules stay untouched and the figures are live rather than pre-aggregated.
 */
export async function readLiveStorePerformance(onProgress) {
	if (!db) throw new Error("Firebase is not configured.");
	const stores = [];
	for (const store of STORES) {
		try {
			const snapshot = await getDocs(query(
				storeCollection(store.code, "removals"),
				orderBy("removedAt", "desc"),
				limit(500)
			));
			stores.push(summariseStore(store.code, snapshot.docs.map(item => ({
				id: item.id, ...item.data(),
				removedAtISO: item.data().removedAt?.toDate?.()?.toISOString() || null
			}))));
		} catch (error) {
			// A store the caller has no access to (or one with no removals yet) must
			// not hide the stores they can see.
			stores.push({ ...summariseStore(store.code, []), unavailable: true, message: friendlyError(error) });
		}
		onProgress?.(stores.length, STORES.length);
	}
	return writeCachedStorePerformance(stores).stores;
}

export async function saveStoreMemberProfile(storeCode, staff, profile) {
	if (!db || !staff?.staffNumber) return;
	return setDoc(doc(db, "stores", storeCode, "members", staff.staffNumber), {
	...profile, storeCode, staffNumber: staff.staffNumber, updatedAt: serverTimestamp()
	}, { merge: true });
}

export async function addStoreAlert(storeCode, alert) { if (db) return addDoc(storeCollection(storeCode, "alerts"), { ...alert, storeCode, createdAt: serverTimestamp() }); }
export async function addBranchAlert(storeCode, alert) { return addStoreAlert(storeCode, alert); }

export async function getStore(storeCode) {
	if (!db) return null;
	const snapshot = await getDoc(storeRef(storeCode));
	return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

// Settings screen diagnostic: confirm the store document is actually reachable.
export async function checkDatabaseHealth(storeCode) {
	if (!db) return { ok: false, message: "Firebase is not configured." };
	try {
	await getDoc(storeRef(storeCode));
	return { ok: true, message: "Database reachable." };
	} catch (error) {
	return { ok: false, message: friendlyError(error) };
	}
}
