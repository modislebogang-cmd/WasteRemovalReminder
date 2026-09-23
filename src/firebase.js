import { initializeApp } from "firebase/app";
import {
	getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
	updateProfile, signOut, sendEmailVerification, sendPasswordResetEmail, reload
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
	"auth/network-request-failed": "Network problem. Check your connection and try again.",
	"permission-denied": "You do not have permission for that action. Check your store access.",
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

	// The store code is part of the derived email, so find the staff record first.
	const matches = await getDocs(query(collection(db, "staff"), where("staffNumber", "==", number), limit(2)));
	if (matches.empty) throw new Error("No account found for that staff number.");
	if (matches.size > 1) throw new Error("This staff number exists in more than one store. Ask an administrator to fix the duplicate.");

	const profile = { id: matches.docs[0].id, ...matches.docs[0].data() };
	if (profile.status === "disabled") throw new Error("This staff account has been disabled.");

	let credential;
	try {
	credential = await signInWithEmailAndPassword(auth, authEmailFor(profile.storeCode, number), password);
	} catch (error) {
	throw new Error(friendlyError(error));
	}

	// Requirement 0.5: the emailed OTP link must be followed before entry.
	if (!credential.user.emailVerified) {
	await signOut(auth);
	const error = new Error("Verify your account using the OTP link sent to your email, then sign in again.");
		error.code = "auth/email-not-verified";
	throw error;
	}

	await setDoc(doc(db, "staff", profile.id), {
		authUid: credential.user.uid,
	status: "active",
	lastLoginAt: serverTimestamp()
	}, { merge: true });
	return { ...profile, authUid: credential.user.uid, status: "active" };
}

// Re-send the verification OTP for an account that hasn't confirmed yet.
export async function resendVerificationOtp(staffNumber, password) {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const number = String(staffNumber || "").trim().toUpperCase();
	const matches = await getDocs(query(collection(db, "staff"), where("staffNumber", "==", number), limit(2)));
	if (matches.empty) throw new Error("No account found for that staff number.");
	const profile = matches.docs[0].data();
	try {
	const credential = await signInWithEmailAndPassword(auth, authEmailFor(profile.storeCode, number), password);
	if (credential.user.emailVerified) { await signOut(auth); return false; }
	await sendEmailVerification(credential.user);
	await signOut(auth);
	return true;
	} catch (error) {
	throw new Error(friendlyError(error));
	}
}

export const sendStaffPasswordReset = async (staffNumber) => {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const number = String(staffNumber || "").trim().toUpperCase();
	const matches = await getDocs(query(collection(db, "staff"), where("staffNumber", "==", number), limit(2)));
	if (matches.empty) throw new Error("No account found for that staff number.");
	await sendPasswordResetEmail(auth, authEmailFor(matches.docs[0].data().storeCode, number));
};

export async function getStaffProfile(authUid) {
	if (!db) return null;
	const matches = await getDocs(query(collection(db, "staff"), where("authUid", "==", authUid), limit(1)));
	const staff = matches.docs[0];
	return staff ? { id: staff.id, ...staff.data() } : null;
}

export const updateUserProfile = (user, data) => updateProfile(user, data);
export const logOut = () => signOut(auth);

/**
 * Requirements 0.1-0.5: register a staff member.
 * Creates the Auth credential (which triggers the verification OTP email), writes the
 * staff document, and enrols them in their store.
 */
export async function registerStaffMember(member, setupKey) {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	const storeCode = String(member.storeCode || "").trim();
	const staffNumber = String(member.staffNumber || "").trim().toUpperCase();
	const email = String(member.email || "").trim().toLowerCase();
	if (!storeCode) throw new Error("Please select your store.");
	if (!staffNumber) throw new Error("A staff number is required.");
	if (!email) throw new Error("An email address is required.");
	if (!member.password || member.password.length < 6) throw new Error("Password must be at least 6 characters.");
	if (!setupKey?.trim()) throw new Error("Admin setup key is required.");

	const docId = staffDocId(storeCode, staffNumber);

	// The setup key is validated against a config document and never stored on the
	// staff record, so it cannot be read back out of the database.
	let keyDoc;
	try {
	keyDoc = await getDoc(doc(db, "config", "registration"));
	} catch (error) {
	throw new Error(friendlyError(error));
	}
	if (!keyDoc.exists()) throw new Error("Registration is not configured. Ask an administrator to set the setup key.");
	if (String(keyDoc.data().setupKey || "") !== setupKey.trim()) throw new Error("That admin setup key is not valid.");

	// Creating the Auth user triggers the verification (OTP) email.
	let credential;
	try {
	credential = await createUserWithEmailAndPassword(auth, authEmailFor(storeCode, staffNumber), member.password);
	} catch (error) {
	throw new Error(friendlyError(error));
	}
	await updateProfile(credential.user, { displayName: `${staffNumber} (${storeNameFor(storeCode)})` });

	try {
	await setDoc(doc(db, "staff", docId), {
	staffNumber,
	storeCode,
	storeName: storeNameFor(storeCode),
	phoneNumber: String(member.phoneNumber || "").replace(/\D/g, ""),
	email,
	role: member.role || "staff",
	status: "pending",
		authUid: credential.user.uid,
	createdAt: serverTimestamp()
	});
	await setDoc(doc(db, "stores", storeCode), {
	code: storeCode,
	name: storeNameFor(storeCode),
	memberUids: [credential.user.uid]
	}, { merge: true });
	await sendEmailVerification(credential.user);
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
