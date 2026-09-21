import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "firebase/auth";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "firebase/firestore";
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
export async function signInWithStaff(staffNumber, phoneNumber) {
	if (!auth || !db) throw new Error("Firebase is not configured.");
	if (auth.currentUser) await signOut(auth);
	const credential = await signInAnonymously(auth);
	const normalizedStaff = staffNumber.trim().toUpperCase();
	const normalizedPhone = phoneNumber.replace(/\D/g, "");
	const matches = await getDocs(query(collection(db, "staff"), where("staffNumber", "==", normalizedStaff), limit(1)));
	const staff = matches.docs[0];
	if (!staff || staff.data().phoneNumber !== normalizedPhone) {
		await signOut(auth);
		throw new Error("Staff number or phone number was not recognised.");
	}
	await setDoc(staff.ref, { authUid: credential.user.uid }, { merge: true });
	return { id: staff.id, ...staff.data(), authUid: credential.user.uid };
}
export async function getStaffProfile(authUid) {
	if (!db) return null;
	const matches = await getDocs(query(collection(db, "staff"), where("authUid", "==", authUid), limit(1)));
	const staff = matches.docs[0];
	return staff ? { id: staff.id, ...staff.data() } : null;
}
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signUp = (email, password, displayName) => createUserWithEmailAndPassword(auth, email, password).then(async ({ user }) => { await updateProfile(user, { displayName }); return user; });
export const updateUserProfile = (user, data) => updateProfile(user, data);
export const logOut = () => signOut(auth);
export async function registerStaffMember(member, setupKey) {
	if (!auth || !db || !setupKey?.trim()) throw new Error("Admin setup key is required.");
	const temporaryCredential = auth.currentUser ? null : await signInAnonymously(auth);
	try {
		const staffNumber = member.staffNumber.trim().toUpperCase();
		return await setDoc(doc(db, "staff", staffNumber), {
			...member,
			staffNumber,
			phoneNumber: member.phoneNumber.replace(/\D/g, ""),
			setupKey: setupKey.trim(),
			createdAt: serverTimestamp()
		});
	} finally {
		if (temporaryCredential) await signOut(auth);
	}
}
export async function getUserSettings(staffNumber) { if (!db) return null; const snapshot = await getDoc(doc(db, "staff", staffNumber)); return snapshot.exists() ? snapshot.data().settings || null : null; }
export async function saveUserSettings(staffNumber, settings) { if (db) return setDoc(doc(db, "staff", staffNumber), { settings }, { merge: true }); }
export async function addBranchAlert(branchId, alert) { if (db) return addDoc(branchCollection(branchId, "alerts"), { ...alert, createdAt: serverTimestamp() }); }
export function watchBranchAlerts(branchId, onAlerts, onError) { if (!db) return () => {}; return onSnapshot(query(branchCollection(branchId, "alerts"), orderBy("createdAt", "desc"), limit(100)), snapshot => onAlerts(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); }
export const branchRef = (branchId) => doc(db, "branches", branchId);
export const branchCollection = (branchId, name) => collection(db, "branches", branchId, name);
export async function createBranch(name, user) { const branch = await addDoc(collection(db, "branches"), { name, ownerId: user.uid, memberIds: [user.uid], createdAt: serverTimestamp() }); return { id: branch.id, name }; }
export async function addSharedProduct(branchId, product, userId) { return setDoc(doc(db, "branches", branchId, "products", product.id), { ...product, createdBy: userId, updatedAt: serverTimestamp() }); }
export async function updateSharedProduct(branchId, productId, data, userId) { return updateDoc(doc(db, "branches", branchId, "products", productId), { ...data, updatedBy: userId, updatedAt: serverTimestamp() }); }
export async function addActivity(branchId, activity) { return addDoc(branchCollection(branchId, "activity"), { ...activity, createdAt: serverTimestamp() }); }
export function watchBranch(branchId, onProducts, onCategories, onActivity, onError) { const productsQuery = query(branchCollection(branchId, "products"), orderBy("updatedAt", "desc")); const activityQuery = query(branchCollection(branchId, "activity"), orderBy("createdAt", "desc"), limit(100)); const unsubProducts = onSnapshot(productsQuery, snapshot => onProducts(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); const unsubCategories = onSnapshot(branchRef(branchId), snapshot => onCategories(snapshot.data()?.categories || ["Dairy", "Meat", "Bakery", "Beverages", "Frozen", "General"]), onError); const unsubActivity = onSnapshot(activityQuery, snapshot => onActivity(snapshot.docs.map(item => ({ id: item.id, ...item.data(), timestamp: item.data().timestamp || item.data().createdAt?.toDate?.()?.toISOString() }))), onError); return () => { unsubProducts(); unsubCategories(); unsubActivity(); }; }
export const saveBranchCategories = (branchId, categories) => setDoc(branchRef(branchId), { categories }, { merge: true });
export const getBranchesForUser = (userId, callback, onError) => { const branchQuery = query(collection(db, "branches"), where("memberIds", "array-contains", userId)); return onSnapshot(branchQuery, snapshot => callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError); };
