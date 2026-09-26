﻿﻿import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Html5Qrcode } from "html5-qrcode";
import {
  Bell, CheckCircle2, ChevronRight, Clock3, Package,
  Plus, Search, Settings, Trash2, X, AlertTriangle, CalendarDays,
  LayoutDashboard, ScanLine, ListChecks, Download, LogOut, Activity, UserCircle, ShieldCheck, Send, Save,
  ImagePlus, Pencil, BarChart3, TrendingUp, Loader2
} from "lucide-react";
import {
  firebaseEnabled, watchAuth, signInWithStaff, getStaffProfile, registerStaffMember, saveUserSettings, logOut,
  STORES, storeNameFor, watchStore, addSharedProduct, updateSharedProduct, addActivity, saveStoreCategories,
  addStoreAlert, recordRemoval, watchRemovals, watchDailyAnalytics, updateStaffProfile, checkDatabaseHealth,
  sendStaffPasswordReset, friendlyError, STORE_PERFORMANCE_TTL_MS, readCachedStorePerformance,
  readLiveStorePerformance
} from "./firebase";
import "./styles.css";

// The staff document is keyed by store + staff number, neither of which is known on
// a fresh page load. Remembering them locally lets the signed-in user read their own
// document directly, instead of querying `staff` by authUid — a query the Firestore
// rules cannot prove is permitted, which surfaces as "Missing or insufficient
// permissions". This is a cache of identifiers only, not of credentials.
const STAFF_CACHE_KEY = "rwr.staffKey";
const readCachedStaff = () => {
  try {
    const raw = window.localStorage.getItem(STAFF_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeCachedStaff = (value) => {
  try {
    window.localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — sign-in still works, it just re-resolves each load */
  }
};
const clearCachedStaff = () => {
  try { window.localStorage.removeItem(STAFF_CACHE_KEY); } catch { /* ignore */ }
};

const daysUntil = (date) => {
  const a = new Date(); a.setHours(0,0,0,0);
  const b = new Date(date); b.setHours(0,0,0,0);
  return Math.round((b-a)/86400000);
};
const defaultCategories = ["Dairy", "Meat", "Bakery", "Beverages", "Frozen", "General"];
const defaultAlertSettings = { push: false, dailySummary: true, summaryTime: "08:00", reminderDays: 1, escalateAfterHours: 4 };

/* ------------------------------------------------- product pictures (free) ---
 * Requirement (new #1): any user can upload or snap a picture of the product.
 * There is no paid Storage bucket in use, so the picture is downscaled on the
 * device and kept as a compact base64 data URL on the product document itself.
 * That means no new service, no new cost, and it syncs to the team for free.
 */
const MAX_IMAGE_EDGE = 640;
const MAX_IMAGE_BYTES = 90000;

// Resize + compress the chosen file so it comfortably fits inside a Firestore
// document alongside the rest of the product fields.
const readImageFile = (file) => new Promise((resolve, reject) => {
  if (!file) return reject(new Error("No image was selected."));
  if (!String(file.type || "").startsWith("image/")) return reject(new Error("Choose an image file (JPG, PNG or WebP)."));
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("That image could not be read. Try another one."));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error("That image could not be read. Try another one."));
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > MAX_IMAGE_BYTES && quality > 0.3) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(dataUrl);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// One reusable control so "add" and "edit" offer exactly the same picture flow.
function ImagePicker({value,onChange,label}) {
  const inputRef = useRef(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const pick = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setBusy(true);
    try { onChange(await readImageFile(file)); }
    catch (err) { setError(err?.message || "That image could not be added."); }
    finally { setBusy(false); }
  };
  return <div className="imageUploader">
    <button type="button" className="imageUploaderBtn" onClick={()=>inputRef.current?.click()} title={value?"Change picture":"Upload or take a picture"}>
      {value
        ? <><img src={value} alt="Product picture"/><span className="camOverlay"><ImagePlus size={13}/></span></>
        : busy ? <Loader2 size={20} className="spin"/> : <><ImagePlus size={20}/><span>{busy?"Working...":"Add picture"}</span></>}
    </button>
    <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={pick}/>
    <span className="hint">{label || "Upload or take a photo"}</span>
    {value && <button type="button" className="thumbRemove" onClick={()=>onChange("")}><Trash2 size={13}/> Remove picture</button>}
    {error && <span className="hint" style={{color:"var(--red)"}}>{error}</span>}
  </div>;
}

function App() {
  const [products, setProducts] = useState([]);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const [storeCode, setStoreCode] = useState("");
  const [activities, setActivities] = useState([]);
  const [removals, setRemovals] = useState([]);
  const [analyticsDays, setAnalyticsDays] = useState([]);
  const [syncError, setSyncError] = useState("");
  const [user, setUser] = useState("");
  const [userRole, setUserRole] = useState("staff");
  const [categories, setCategories] = useState(defaultCategories);
  const [tab, setTab] = useState("dashboard");
  const [showScanner, setShowScanner] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [editingBarcode, setEditingBarcode] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [showNotifications, setShowNotifications] = useState(true);
  const [alertSettings, setAlertSettings] = useState(defaultAlertSettings);
  const [avatarVariant] = useState(() => Math.floor(Math.random() * 4));
  // Requirement 2 + 3 (new): the details popup and the edit form.
  const [detailsId, setDetailsId] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) return;
    return watchAuth(async currentUser => {
      setFirebaseUser(currentUser);
      if (!currentUser) {
        setUser("");
        setStaffProfile(null);
        setUserRole("staff");
        setStoreCode("");
        setProducts([]);
        setActivities([]);
        setRemovals([]);
        setAnalyticsDays([]);
        setCategories(defaultCategories);
        setAlertSettings(defaultAlertSettings);
        clearCachedStaff();
        return;
      }
      try {
        // The staff document ID is derived from store + staff number, which are not
        // known until we read the record. A `where` query on authUid cannot be proved
        // against the rules, so the resolved id is cached locally after sign-in.
        const cached = readCachedStaff();
        const profile = await getStaffProfile(currentUser.uid, cached?.storeCode, cached?.staffNumber);
        if (profile) {
          setStaffProfile(profile);
          setUser(profile.staffNumber);
          setUserRole(profile.role || "staff");
          setStoreCode(profile.storeCode || "");
          setAlertSettings({ ...defaultAlertSettings, ...(profile.settings || {}) });
          writeCachedStaff({ storeCode: profile.storeCode, staffNumber: profile.staffNumber });
        }
      } catch (error) {
        setSyncError(friendlyError(error));
      }
    });
  }, []);

  // Requirement 2/3/4: live products, categories and activity for this store.
  useEffect(() => {
    if (!firebaseEnabled || !firebaseUser || !storeCode) return;
    return watchStore(storeCode, setProducts, setCategories, setActivities,
      () => setSyncError("Live sync is unavailable for this store. Check your Firestore rules."));
  }, [firebaseUser, storeCode]);

  // Requirement 6: removal history for the Activity menu.
  useEffect(() => {
    if (!firebaseEnabled || !firebaseUser || !storeCode) return;
    return watchRemovals(storeCode, setRemovals, () => setSyncError("Could not load removal history."));
  }, [firebaseUser, storeCode]);

  // Requirement 3: daily waste analytics.
  useEffect(() => {
    if (!firebaseEnabled || !firebaseUser || !storeCode) return;
    return watchDailyAnalytics(storeCode, setAnalyticsDays, () => setSyncError("Could not load analytics."));
  }, [firebaseUser, storeCode]);

  // Staff identity used for attribution on products, removals and activity.
  const currentStaff = useMemo(() => ({
    staffNumber: staffProfile?.staffNumber || user || "",
    displayName: staffProfile?.displayName || user || "",
    authUid: firebaseUser?.uid || ""
  }), [staffProfile, user, firebaseUser]);

  const recordActivity = (action, details) => {
    const username = user || "Anonymous";
    if (firebaseEnabled && firebaseUser && storeCode) {
      addActivity(storeCode, { username, userId: firebaseUser.uid, action, details })
        .catch(error => setSyncError(friendlyError(error)));
    } else {
      setSyncError("Firebase is required to save activity.");
    }
  };

  const active = products.filter(p => p.status === "active");
  const dueToday = active.filter(p => daysUntil(p.expiry) === 0);
  const expired = active.filter(p => daysUntil(p.expiry) < 0);
  const upcoming = active.filter(p => daysUntil(p.expiry) > 0 && daysUntil(p.expiry) <= 7);
  const reminderProducts = active.filter(p => daysUntil(p.expiry) <= Number(alertSettings.reminderDays || 0));

  // Advanced filtering
  const filtered = useMemo(() => {
    let result = active;

    // Search filter
    if (search) {
      result = result.filter(p =>
        `${p.name} ${p.barcode} ${p.category}`.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      const d = daysUntil;
      if (filterStatus === "expired") result = result.filter(p => d(p.expiry) < 0);
      if (filterStatus === "today") result = result.filter(p => d(p.expiry) === 0);
      if (filterStatus === "upcoming") result = result.filter(p => d(p.expiry) > 0 && d(p.expiry) <= 7);
      if (filterStatus === "safe") result = result.filter(p => d(p.expiry) > 7);
    }

    // Category filter
    if (filterCategory !== "all") {
      result = result.filter(p => p.category === filterCategory);
    }

    // Expiry range filter
    if (filterExpiry !== "all") {
      const d = daysUntil;
      if (filterExpiry === "0-3") result = result.filter(p => d(p.expiry) >= 0 && d(p.expiry) <= 3);
      if (filterExpiry === "4-7") result = result.filter(p => d(p.expiry) >= 4 && d(p.expiry) <= 7);
      if (filterExpiry === "8+") result = result.filter(p => d(p.expiry) > 7);
    }

    return result;
  }, [active, search, filterStatus, filterCategory, filterExpiry]);

  const removeProduct = (id) => {
    const target = products.find(p => p.id === id);
    setProducts(ps => ps.map(p => p.id === id ? {...p, status:"removed", removedAt: new Date().toISOString(), removedByStaffNumber: currentStaff.staffNumber} : p));
    if (firebaseEnabled && firebaseUser && storeCode) {
      updateSharedProduct(storeCode, id, { status: "removed" }, currentStaff).catch(error => setSyncError(friendlyError(error)));
      // Requirements 3 and 6: log the removal for analytics and history.
      if (target) recordRemoval(storeCode, target, currentStaff).catch(error => setSyncError(friendlyError(error)));
    }
    recordActivity("product_removed", `${target?.name || id} - ${target?.category || "General"}`);
  };

  const addProduct = async (data) => {
    const product = {...data, id: crypto.randomUUID(), status:"active"};
    setProducts(ps => [product, ...ps]);
    try {
      if (firebaseEnabled && firebaseUser && storeCode) await addSharedProduct(storeCode, product, currentStaff);
      recordActivity("product_added", `${data.name} - ${data.category}`);
      setShowAdd(false);
    } catch (error) {
      setProducts(ps => ps.filter(item => item.id !== product.id));
      setSyncError(`Could not save product. ${friendlyError(error)}`);
    }
  };

  // Requirement 3 (new): save corrected product details, including the picture.
  const saveProductEdits = async (id, updates) => {
    const previous = products.find(p => p.id === id);
    setProducts(ps => ps.map(p => p.id === id ? { ...p, ...updates, updatedByName: currentStaff.displayName || currentStaff.staffNumber } : p));
    try {
      if (firebaseEnabled && firebaseUser && storeCode) await updateSharedProduct(storeCode, id, updates, currentStaff);
      recordActivity("product_updated", `${updates.name || previous?.name || id} - details edited${updates.image !== previous?.image ? " (picture changed)" : ""}`);
    } catch (error) {
      if (previous) setProducts(ps => ps.map(p => p.id === id ? previous : p));
      setSyncError(`Could not update the product. ${friendlyError(error)}`);
    }
  };

  useEffect(() => {
    if (!user || !("Notification" in window) || !showNotifications) return;
    const reminders = active.filter(p => daysUntil(p.expiry) <= Number(alertSettings.reminderDays || 0));
    if (Notification.permission === "granted" && reminders.length) {
      new Notification("RemoveWasteReminder", {
        body: reminders.length === 1 ? `${reminders[0].name} needs attention soon.` : `${reminders.length} products need attention soon.`
      });
    }
  }, [user, showNotifications, active, alertSettings.reminderDays]);

  if (!firebaseEnabled) return <FirebaseConfigView />;
  if (!firebaseUser || !user) return <AuthView
    onSignIn={async (staffNumber, password) => {
      const profile = await signInWithStaff(staffNumber, password);
      // Cache the identifiers so the next page load can read this staff document
      // directly, instead of querying `staff` by authUid (which the rules cannot
      // prove is permitted).
      writeCachedStaff({ storeCode: profile.storeCode, staffNumber: profile.staffNumber });
      setStaffProfile(profile);
      setUser(profile.staffNumber);
      setUserRole(profile.role || "staff");
      setStoreCode(profile.storeCode || "");
      setAlertSettings({ ...defaultAlertSettings, ...(profile.settings || {}) });
    }}
    onRegister={async (member) => { await registerStaffMember(member); }}
    onForgotPassword={async (staffNumber) => sendStaffPasswordReset(staffNumber)}
  />;
  if (!storeCode) return <StoreMissingView profile={staffProfile} onSignOut={logOut} />;

  // Requirement 2 (new): the product whose details popup is open, kept in sync
  // with the live collection so an edit shows immediately.
  const detailedProduct = detailsId ? products.find(p => p.id === detailsId) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brandLogo" src="/Wasteremovalreminder.png" alt="Waste Removal Reminder" />
        </div>
        <div className="topActions">
          <button className="iconBtn" onClick={async()=>{ if("Notification" in window) await Notification.requestPermission(); }} title="Enable notifications"><Bell size={19}/></button>
          {userRole === "manager" && <div className="roleSelector">
            <select value={userRole} onChange={e=>{setUserRole(e.target.value); recordActivity("role_changed", `Changed to ${e.target.value}`);}} className="roleSelect">
              <option value="staff">Staff</option><option value="manager">Manager</option>
            </select>
          </div>}
          <button className={`userChip avatarVariant${avatarVariant}`} onClick={()=>setTab("settings")} aria-label="Open user settings"><span>{(user || "U")[0].toUpperCase()}</span></button>
        </div>
      </header>

      <main className="content">
        {syncError && <div className="inAppNotification"><AlertTriangle size={20}/><div><strong>Sync notice</strong><span>{syncError}</span></div><button onClick={() => setSyncError("")} className="closeNotif"><X size={16}/></button></div>}
        {showNotifications && reminderProducts.length > 0 && (
          <div className="inAppNotification">
            <AlertTriangle size={20}/>
            <div>
              <strong>Action Required!</strong>
              <span>{reminderProducts.length} product(s) need attention within your alert window</span>
            </div>
            <button onClick={() => setShowNotifications(false)} className="closeNotif"><X size={16}/></button>
          </div>
        )}
        {tab === "dashboard" && <>
          <section className="hero">
            <div>
              <p className="eyebrow">SALES FLOOR CONTROL</p>
              <h1>Stop expiry waste<br/><span>before it happens.</span></h1>
              <p className="heroText">Scan a product barcode, add its expiry date, and keep your team ahead of removals.</p>
              <div className="heroBtns">
                <button className="primary" onClick={()=>setShowScanner(true)}><ScanLine size={19}/> Scan barcode</button>
                <button className="secondary" onClick={()=>setShowAdd(true)}><Plus size={19}/> Add manually</button>
              </div>
            </div>
            <div className="heroVisual">
              <div className="scanCard">
                <div className="scanGlow"></div><ScanLine size={70}/>
                <span>READY TO SCAN</span>
              </div>
            </div>
          </section>

          <section className="stats">
            <Stat icon={<AlertTriangle/>} label="Remove today" value={dueToday.length + expired.length} tone="danger"/>
            <Stat icon={<Clock3/>} label="Next 7 days" value={upcoming.length} tone="warning"/>
            <Stat icon={<Package/>} label="Tracked products" value={active.length} tone="blue"/>
          </section>

          <section className="section">
            <div className="sectionHead"><div><p className="eyebrow">ACTION REQUIRED</p><h2>Products to remove</h2></div><button className="textBtn" onClick={()=>setTab("products")}>View all <ChevronRight size={16}/></button></div>
            {dueToday.length + expired.length === 0 ? <Empty icon={<CheckCircle2/>} text="No products need removal today."/> :
              <div className="productGrid">{[...expired,...dueToday].map(p=><ProductCard key={p.id} p={p} onRemove={removeProduct} onOpen={item=>setDetailsId(item.id)}/>)}</div>}
          </section>

          <section className="section">
            <div className="sectionHead"><div><p className="eyebrow">COMING UP</p><h2>Expiry watch</h2></div></div>
            {upcoming.length ? <div className="productGrid">{upcoming.slice(0,4).map(p=><ProductCard key={p.id} p={p} onOpen={item=>setDetailsId(item.id)}/>)}</div> : <Empty icon={<CalendarDays/>} text="No upcoming expiries in the next 7 days."/>}
          </section>
        </>}

        {tab === "products" && <section className="pageSection">
          <div className="pageTitle">
            <div><p className="eyebrow">INVENTORY</p><h1>Tracked products</h1></div>
            <div style={{display:"flex",gap:"10px"}}>
              <button className="primary" onClick={()=>setShowScanner(true)}><ScanLine size={18}/> Scan product</button>
              {userRole === "manager" && <button className="secondary" onClick={() => exportToCSV(filtered, user, recordActivity)}><Download size={18}/> Export CSV</button>}
            </div>
          </div>
          <div className="search"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product or barcode..."/></div>
          <div className="filters">
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="filterSelect">
              <option value="all">All Status</option>
              <option value="expired">Expired</option>
              <option value="today">Remove Today</option>
              <option value="upcoming">Upcoming (7 days)</option>
              <option value="safe">Safe (8+ days)</option>
            </select>
            <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)} className="filterSelect">
              <option value="all">All Categories</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select value={filterExpiry} onChange={e=>setFilterExpiry(e.target.value)} className="filterSelect">
              <option value="all">All Expiry Ranges</option>
              <option value="0-3">0-3 days</option>
              <option value="4-7">4-7 days</option>
              <option value="8+">8+ days</option>
            </select>
          </div>
          <div className="productGrid">{filtered.length ? filtered.map(p=><ProductCard key={p.id} p={p} onRemove={removeProduct} onOpen={item=>setDetailsId(item.id)} userRole={userRole}/>) : <Empty icon={<Package/>} text="No products match your filters."/>}</div>
        </section>}

        {tab === "settings" && <section className="pageSection narrow">
          <p className="eyebrow">ACCOUNT</p><h1>Settings</h1>
          <div className="settingsCard">
            {/* Requirement 5: view and update the user profile. */}
            <ProfileEditor
              staffProfile={staffProfile}
              storeCode={storeCode}
              userRole={userRole}
              onSave={async updates => {
                await updateStaffProfile(staffProfile.id, updates);
                setStaffProfile(current => ({ ...current, ...updates }));
                if (firebaseUser) await updateUserProfile(firebaseUser, { displayName: updates.displayName || user });
                recordActivity("profile_updated", "Updated profile details");
              }}
              onCheckHealth={async () => {
                const result = await checkDatabaseHealth(storeCode);
                recordActivity("db_health_check", result.message);
                return result;
              }}
            />
            <button className="textBtn" onClick={logOut}><LogOut size={16}/> Sign out</button>
            <label>User Role</label>
            <p className="hint">{userRole.charAt(0).toUpperCase() + userRole.slice(1)}</p>
            {userRole === "manager" && (
              <>
                <label style={{marginTop:"20px"}}>Manage Categories</label>
                <div className="categoryList">
                  {categories.map(cat => (
                    <div key={cat} className="categoryItem">
                      <span>{cat}</span>
                      <button onClick={() => {const next = categories.filter(c => c !== cat); setCategories(next); if(firebaseEnabled && storeCode) saveStoreCategories(storeCode, next);}} className="removeBtn" style={{padding:"4px 8px"}}><Trash2 size={16}/></button>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex", gap:"10px", marginTop:"10px"}}>
                  <input type="text" id="newCat" placeholder="New category" style={{flex:1, padding:"8px"}}/>
                  <button onClick={() => {const el = document.getElementById("newCat"); if(el.value) { const next = [...categories, el.value]; setCategories(next); if(firebaseEnabled && storeCode) saveStoreCategories(storeCode, next); el.value = ""; }}} className="secondary">Add</button>
                </div>
              </>
            )}
            <AlertSettings settings={alertSettings} onChange={setAlertSettings} onRequestPush={async()=>{ if(!("Notification" in window)) return "This browser does not support notifications."; const permission=await Notification.requestPermission(); const granted=permission === "granted"; setAlertSettings(current=>({...current,push:granted})); if(granted && staffProfile?.id){ await saveUserSettings(staffProfile.id,{...alertSettings,push:true}); } recordActivity("push_notifications_enabled", granted?"Push notifications enabled":"Push permission not granted"); return granted?"" : "Notifications are blocked. Allow notifications for this site in your browser settings, then try again."; }} onDisablePush={async()=>{ setAlertSettings(current=>({...current,push:false})); if(staffProfile?.id){ await saveUserSettings(staffProfile.id,{...alertSettings,push:false}); } recordActivity("push_notifications_disabled","Push notifications turned off"); }} onSave={async next=>{if(staffProfile?.id) await saveUserSettings(staffProfile.id,next);recordActivity("alert_settings_updated",`Alerts ${next.dailySummary?"enabled":"disabled"}`)}} onEscalate={async message=>{if(firebaseEnabled && firebaseUser && storeCode) await addStoreAlert(storeCode,{message,from:user,type:"manager_escalation",status:"open"});recordActivity("manager_escalation",message)}} />
            <p className="hint">Staff can scan products and manage removals. Managers can view activity, export reports, and manage categories.</p>
          </div>
        </section>}

        {/* Requirements 3 and 6: analytics + waste removal history, both in Activity. */}
        {tab === "activity" && <ActivityView
          activities={activities}
          removals={removals}
          analyticsDays={analyticsDays}
          storeCode={storeCode}
          storeName={storeNameFor(storeCode)}
          userRole={userRole}
          currentStaffNumber={currentStaff.staffNumber}
        />}
      </main>

      <nav className="bottomNav">
        <NavItem active={tab==="dashboard"} icon={<LayoutDashboard/>} text="Dashboard" onClick={()=>setTab("dashboard")}/>
        <NavItem active={tab==="products"} icon={<ListChecks/>} text="Products" onClick={()=>setTab("products")}/>
        <NavItem active={false} icon={<ScanLine/>} text="Scan" primary onClick={()=>setShowScanner(true)}/>
        {/* Requirement 6: Activity is available to every role so staff can see their own history. */}
        <NavItem active={tab==="activity"} icon={<Activity/>} text="Activity" onClick={()=>setTab("activity")}/>
        <NavItem active={tab==="settings"} icon={<Settings/>} text="Settings" onClick={()=>setTab("settings")}/>
      </nav>

      {showScanner && <ScannerModal onClose={()=>setShowScanner(false)} onScanned={(code)=>{setEditingBarcode(code);setShowScanner(false);setShowAdd(true)}}/>}
      {showAdd && <AddModal barcode={editingBarcode} onClose={()=>setShowAdd(false)} onSave={addProduct}/>}
      {/* Requirement 2 (new): details popup, opened from any product card. */}
      {detailedProduct && !showEdit && <ProductDetailsModal
        product={detailedProduct}
        userRole={userRole}
        onClose={()=>setDetailsId("")}
        onRemove={id=>{removeProduct(id);setDetailsId("");}}
        onEdit={()=>setShowEdit(true)}
      />}
      {/* Requirement 3 (new): edit the product from inside its details popup. */}
      {detailedProduct && showEdit && <EditProductModal
        product={detailedProduct}
        categories={categories}
        canManageCost={userRole === "manager"}
        onClose={()=>{setShowEdit(false);setDetailsId("");}}
        onSave={async updates=>{await saveProductEdits(detailedProduct.id, updates);setShowEdit(false);setDetailsId("");}}
      />}
    </div>
  );
}

function FirebaseConfigView() {
  return <div className="modalBackdrop"><div className="modal"><p className="eyebrow">SECURE ACCESS</p><h2>Firebase configuration required</h2><p className="hint">Add the VITE_FIREBASE environment variables, then reload the app to sign in with your staff number and password.</p></div></div>;
}

/**
 * Requirements 0.1-0.5 and 1.
 * Sign in takes a staff number and password only. Registration collects staff number,
 * store, phone, email and password.
 */
function AuthView({onSignIn,onRegister,onForgotPassword}) {
  const [staffNumber,setStaffNumber]=useState(""); const [password,setPassword]=useState("");
  const [phoneNumber,setPhoneNumber]=useState(""); const [email,setEmail]=useState("");
  const [storeCode,setStoreCode]=useState(""); const [role,setRole]=useState("staff");
  const [register,setRegister]=useState(false);
  const [forgot,setForgot]=useState(false);
  const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false);

  const submit=async e=>{
    e.preventDefault(); setError(""); setNotice("");
    if(!window.confirm("This is a private app made by Woolworths staff and is only for Woolworths. MADE WITH LOVE USING AI BY YOURDEVLEBO"))return;
    setBusy(true);
    try{
      if(register){
        if(!storeCode){setError("Please select your store.");return;}
        if(!email.trim()){setError("An email address is required.");return;}
        if(password.length<6){setError("Password must be at least 6 characters.");return;}
        await onRegister({staffNumber,phoneNumber,storeCode,role,email,password});
        setRegister(false); setPassword("");
        setNotice(`Registration submitted for ${staffNumber.toUpperCase()}. You can now sign in with your password.`);
      } else {
        await onSignIn(staffNumber,password);
      }
    }catch(err){
      setError(err?.message||"Could not verify those details.");
    }finally{ setBusy(false); }
  };

  // Forgot password: the staff number alone identifies the account, so a reset
  // link is emailed to the address registered against it.
  const sendReset=async e=>{
    e.preventDefault(); setError(""); setNotice("");
    if(!staffNumber){setError("Enter your staff number first.");return;}
    setBusy(true);
    try{
      await onForgotPassword(staffNumber);
      setForgot(false); setPassword("");
      setNotice(`Password reset link sent for ${staffNumber.toUpperCase()}. Check the email address registered to that staff number, then sign in with your new password.`);
    }catch(err){
      setError(err?.message||"Could not send the password reset link.");
    }finally{ setBusy(false); }
  };

  if(forgot) return <div className="modalBackdrop"><div className="modal authModal">
    <img className="authLogo" src="/Wasteremovalreminder.png" alt="Waste Removal Reminder"/>
    <p className="eyebrow">SECURE ACCESS</p>
    <h2>Reset your password</h2>
    <form onSubmit={sendReset}>
      <label>Staff number<input value={staffNumber} onChange={e=>setStaffNumber(e.target.value)} required/></label>
      {error&&<div className="error">{error}</div>}
      {notice&&<div className="hint">{notice}</div>}
      <button className="primary wide" type="submit" disabled={busy}><Send size={18}/>{busy?"Working...":"Send reset link"}</button>
    </form>
    <button className="secondary wide adminRegisterBtn" onClick={()=>{setForgot(false);setError("");setNotice("");}}>{register?"Back to sign in":"Back to sign in"}</button>
  </div></div>;

  return <div className="modalBackdrop"><div className="modal authModal">
    <img className="authLogo" src="/Wasteremovalreminder.png" alt="Waste Removal Reminder"/>
    <p className="eyebrow">SECURE ACCESS</p>
    <h2>{register?"Register team member":"Staff sign in"}</h2>
    <form onSubmit={submit}>
      <label>Staff number<input value={staffNumber} onChange={e=>setStaffNumber(e.target.value)} required/></label>
      {register&&<>
        <label>Store<select value={storeCode} onChange={e=>setStoreCode(e.target.value)} className="filterSelect" required><option value="">Select store</option>{STORES.map(store=><option key={store.code} value={store.code}>{store.code}-{store.name}</option>)}</select></label>
        <label>Phone number<input type="tel" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} required/></label>
        <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required/></label>
      </>}
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={register?6:undefined}/></label>
      {register&&<>
        <label>Role<select value={role} onChange={e=>setRole(e.target.value)} className="filterSelect"><option value="staff">Staff</option><option value="manager">Manager</option></select></label>
      </>}
      {error&&<div className="error">{error}</div>}
      {notice&&<div className="hint">{notice}</div>}
      <button className="primary wide" type="submit" disabled={busy}><ShieldCheck size={18}/>{busy?"Working...":register?"Register member":"Sign in"}</button>
    </form>
    {!register&&<button type="button" className="textBtn forgotPasswordBtn" onClick={()=>{setForgot(true);setError("");setNotice("");}}>Forgot password?</button>}
    <button className="secondary wide adminRegisterBtn" onClick={()=>{setRegister(!register);setError("");setNotice("");}}><ShieldCheck size={18}/>{register?"Back to sign in":"Register"}</button>
  </div></div>;
}
// Requirement 5 (new): push and alerts are now explicit Enable / Disable
// buttons. Enabling push asks the browser for permission and only stays on when
// the permission is actually granted; disabling turns it off and saves it.
function AlertSettings({settings,onChange,onRequestPush,onDisablePush,onSave,onEscalate}) {
  const [message,setMessage]=useState("");
  const [pushNote,setPushNote]=useState("");
  const pushEnabled = !!settings.push;
  const alertsEnabled = !!settings.dailySummary;
  const togglePush = async () => {
    if (pushEnabled) { setPushNote(""); await onDisablePush(); }
    else { const result = await onRequestPush(); setPushNote(result || ""); }
  };
  const toggleAlerts = () => onChange({...settings,dailySummary:!alertsEnabled});
  return <div className="phase4Settings">
    <label>Push notifications</label>
    <div className="settingsToggleRow">
      <button className={`toggleBtn ${pushEnabled?"on":"off"}`} onClick={togglePush} disabled={pushEnabled}><Bell size={15}/> Enable</button>
      <button className={`toggleBtn ${pushEnabled?"off":"on"}`} onClick={togglePush} disabled={!pushEnabled}><X size={15}/> Disable</button>
      <span className="toggleState">{pushEnabled?"On":"Off"}</span>
    </div>
    {pushNote&&<p className="hint">{pushNote}</p>}
    <label>Alert notifications</label>
    <div className="settingsToggleRow">
      <button className={`toggleBtn ${alertsEnabled?"on":"off"}`} onClick={toggleAlerts} disabled={alertsEnabled}><AlertTriangle size={15}/> Enable</button>
      <button className={`toggleBtn ${alertsEnabled?"off":"on"}`} onClick={toggleAlerts} disabled={!alertsEnabled}><X size={15}/> Disable</button>
      <span className="toggleState">{alertsEnabled?"On":"Off"}</span>
    </div>
    {alertsEnabled&&<label>Summary time<input type="time" value={settings.summaryTime} onChange={e=>onChange({...settings,summaryTime:e.target.value})}/></label>}
    <label>Alert lead time in days<input type="number" min="0" max="7" value={settings.reminderDays} onChange={e=>onChange({...settings,reminderDays:Number(e.target.value)})}/></label>
    <label>Escalate after hours<input type="number" min="1" max="48" value={settings.escalateAfterHours} onChange={e=>onChange({...settings,escalateAfterHours:Number(e.target.value)})}/></label>
    <button className="secondary wide" onClick={()=>onSave(settings)}><Save size={18}/> Save alert settings</button>
    <label>Message for manager<input value={message} onChange={e=>setMessage(e.target.value)} placeholder="What needs manager attention?"/></label>
    <button className="secondary wide" disabled={!message.trim()} onClick={()=>{onEscalate(message.trim());setMessage("")}}><Send size={18}/> Escalate to manager</button>
  </div>;
}

// Requirement 5: view and update the signed-in user's profile from Settings.
function ProfileEditor({staffProfile,storeCode,userRole,onSave,onCheckHealth}) {
  const [displayName,setDisplayName]=useState(""); const [phoneNumber,setPhoneNumber]=useState("");
  const [email,setEmail]=useState(""); const [status,setStatus]=useState(""); const [busy,setBusy]=useState(false);

  useEffect(()=>{
    setDisplayName(staffProfile?.displayName || String());
    setPhoneNumber(staffProfile?.phoneNumber || String());
    setEmail(staffProfile?.email || String());
  },[staffProfile]);

  const save=async()=>{
    setStatus(""); setBusy(true);
    try{
      await onSave({displayName:displayName.trim(),phoneNumber:phoneNumber.replace(/\D/g,""),email:email.trim().toLowerCase()});
      setStatus("Profile updated.");
    }catch(err){ setStatus(friendlyError(err)); }
    finally{ setBusy(false); }
  };

  return <>
    <label>Staff number</label>
    <input value={staffProfile?.staffNumber || String()} readOnly/>
    <label>Store</label>
    <p className="hint">{storeCode?`${storeCode}-${storeNameFor(storeCode)}`:"Not assigned"}</p>
    <label>Role</label>
    <p className="hint">{(userRole||"staff").charAt(0).toUpperCase()+(userRole||"staff").slice(1)}</p>
    <label>Display name</label>
    <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="How your name shows on activity"/>
    <label>Phone number</label>
    <input type="tel" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} placeholder="e.g. 0821234567"/>
    <label>Email address</label>
    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/>
    <label>Account status</label>
    <p className="hint">{staffProfile?.status==="active"?"Active":staffProfile?.status==="disabled"?"Disabled":"Pending"}</p>
    {status&&<p className="hint">{status}</p>}
    <button className="secondary wide" onClick={save} disabled={busy}><UserCircle size={18}/>{busy?"Saving...":"Save profile"}</button>
    <button className="textBtn" onClick={async()=>{const r=await onCheckHealth(); setStatus(r.message);}}>Check database connection</button>
  </>;
}

// Shown if a signed-in staff member has no store assigned on their record.
function StoreMissingView({profile,onSignOut}) {
  return <div className="modalBackdrop"><div className="modal">
    <p className="eyebrow">STORE MANAGEMENT</p>
    <h2>No store assigned</h2>
    <p className="hint">Your staff record{profile?.staffNumber?` (${profile.staffNumber})`:""} is not linked to a store. Ask a manager to assign you to 3156-Groblersdal or 3138-Jean Crossing, then sign in again.</p>
    <button className="textBtn" onClick={onSignOut}><LogOut size={16}/> Sign out</button>
  </div></div>;
}

function Stat({icon,label,value,tone}) {
  return <div className={`stat ${tone}`}><div className="statIcon">{React.cloneElement(icon,{size:19})}</div><div><strong>{value}</strong><span>{label}</span></div></div>
}
function NavItem({active,icon,text,onClick,primary}) {
  return <button className={`navItem ${active?"active":""} ${primary?"navPrimary":""}`} onClick={onClick}>{icon}<span>{text}</span></button>
}
function Empty({icon,text}) { return <div className="empty">{icon}<span>{text}</span></div> }

function ProductCard({p,onRemove,userRole,onOpen}) {
  const d=daysUntil(p.expiry);
  const urgency=d<0?"expired":d===0?"today":d<=2?"soon":"normal";
  // Requirement 2: tappingere on the card opens the product details popup.
  const open = onOpen ? () => onOpen(p) : undefined;
  return <div className={`productCard ${urgency} ${open?"cardClickable":""}`} onClick={open} role={open?"button":undefined} tabIndex={open?0:undefined}
    onKeyDown={open?e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}}:undefined}
    title={open?"Tap for product details":undefined}>
    <div className={`productIcon ${p.image?"hasPhoto":""}`}>{p.image?<img src={p.image} alt={p.name}/>:<Package size={22}/>}</div>
    <div className="productInfo"><strong>{p.name}</strong><span>{p.category || "General"} · {p.barcode}</span></div>
    <div className="expiry"><span>{d<0?`${Math.abs(d)}d overdue`:d===0?"REMOVE TODAY":`${d}d left`}</span><b>{new Date(p.expiry).toLocaleDateString()}</b></div>
    {(onRemove && (userRole === "staff" || userRole === "manager")) && <button className="removeBtn" onClick={e=>{e.stopPropagation();onRemove(p.id);}} title="Mark removed"><CheckCircle2 size={19}/></button>}
  </div>
}

function ScannerModal({onClose,onScanned}) {
  const scannerRef=useRef(null);
  const capturedRef=useRef(false);
  const [error,setError]=useState("");
  const [captured,setCaptured]=useState(false);
  useEffect(()=>{
    const scanner = new Html5Qrcode("barcode-reader");
    scannerRef.current=scanner;
    scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:140}},
      async text=>{
        if (capturedRef.current) return;
        capturedRef.current=true;
        setCaptured(true);
        try{await scanner.stop()}catch{}
        window.setTimeout(() => onScanned(text), 450);
      },
      ()=>{}
    ).catch(()=>setError("Camera access was blocked. Allow camera permission or add the barcode manually."));
    return ()=>{ if(scannerRef.current?.isScanning) scannerRef.current.stop().catch(()=>{}); };
  },[]);
  return <div className="modalBackdrop"><div className="modal scannerModal">
    <button className="close" onClick={onClose}><X/></button><p className="eyebrow">BARCODE SCANNER</p><h2>{captured ? "Barcode captured" : "Scan product"}</h2>
    <div className={`scannerFrame ${captured ? "captured" : ""}`}><div id="barcode-reader"></div><div className="scannerGuide"><span></span></div></div>
    {error && <div className="error">{error}</div>}
    <p className="hint">{captured ? "Barcode captured. Complete the product name and expiry date to save the reminder." : "Point your phone camera at the product barcode. EAN-13, EAN-8, UPC and other common retail codes are supported by the scanner library."}</p>
  </div></div>
}

// Requirement 1 (new): any user may attach a picture of the product when adding it.
function AddModal({barcode,onClose,onSave}) {
  const [name,setName]=useState(""); const [expiry,setExpiry]=useState(""); const [category,setCategory]=useState("");
  const [image,setImage]=useState("");
  return <div className="modalBackdrop"><div className="modal">
    <button className="close" onClick={onClose}><X/></button><p className="eyebrow">PRODUCT DETAILS</p><h2>Register product</h2>
    <label>Product name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Fresh Milk 2L"/></label>
    <label>Barcode<input value={barcode} readOnly/></label>
    <label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
    <label>Category<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Dairy"/></label>
    <label>Product picture</label>
    <ImagePicker value={image} onChange={setImage}/>
    <button className="primary wide" disabled={!name||!expiry} onClick={()=>onSave({name,barcode,expiry,category,image})}><Bell size={18}/> Save & remind me</button>
  </div></div>
}

/**
 * Requirements 2 and 3 (new).
 * Tapping a product opens this popup: it shows the product picture (or the icon
 * when no picture was uploaded), every detail on record, and for staff/managers
 * the removal and edit actions.
 */
function ProductDetailsModal({product,userRole,onClose,onRemove,onEdit}) {
  const d = daysUntil(product.expiry);
  const canAct = userRole === "staff" || userRole === "manager";
  return <div className="modalBackdrop" onClick={onClose}><div className="modal detailsModal" onClick={e=>e.stopPropagation()}>
    <button className="close" onClick={onClose}><X/></button>
    <p className="eyebrow">PRODUCT DETAILS</p>
    <div className="detailsImage">{product.image?<img src={product.image} alt={product.name}/>:<Package size={64}/>}</div>
    <h2>{product.name}</h2>
    <div className="detailRow"><span>Category</span><strong>{product.category || "General"}</strong></div>
    <div className="detailRow"><span>Barcode</span><strong>{product.barcode || "Not recorded"}</strong></div>
    <div className="detailRow"><span>Expiry date</span><strong>{new Date(product.expiry).toLocaleDateString()}</strong></div>
    <div className="detailRow"><span>Time remaining</span><strong className={d<0?"lateEm":"onTimeEm"}>{d<0?`${Math.abs(d)} day(s) overdue`:d===0?"REMOVE TODAY":`${d} day(s) left`}</strong></div>
    <div className="detailRow"><span>Picture</span><strong>{product.image?"Uploaded":"Icon only"}</strong></div>
    {product.createdByName && <div className="detailRow"><span>Added by</span><strong>{product.createdByName}</strong></div>}
    {product.updatedByName && <div className="detailRow"><span>Last edited by</span><strong>{product.updatedByName}</strong></div>}
    {product.removedByName && <div className="detailRow"><span>Removed by</span><strong>{product.removedByName}</strong></div>}
    <div className="detailActions">
      {canAct && <button className="secondary" onClick={()=>onEdit(product)}><Pencil size={17}/> Edit details</button>}
      {canAct && <button className="removeBtn" onClick={()=>onRemove(product.id)} title="Mark removed"><CheckCircle2 size={17}/> Mark removed</button>}
      <button className="secondary" onClick={onClose}>Close</button>
    </div>
  </div></div>;
}

// Requirement 3 (new): everyone can correct a product's details, including its picture.
function EditProductModal({product,categories,canManageCost,onClose,onSave}) {
  const [name,setName]=useState(product.name || "");
  const [barcode,setBarcode]=useState(product.barcode || "");
  const [expiry,setExpiry]=useState(product.expiry || "");
  const [category,setCategory]=useState(product.category || "");
  const [quantity,setQuantity]=useState(product.quantity ?? 1);
  const [unitCost,setUnitCost]=useState(product.unitCost ?? 0);
  const [image,setImage]=useState(product.image || "");
  return <div className="modalBackdrop"><div className="modal">
    <button className="close" onClick={onClose}><X/></button><p className="eyebrow">EDIT PRODUCT</p><h2>Update product details</h2>
    <label>Product name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Fresh Milk 2L"/></label>
    <label>Barcode<input value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="Scan or type the barcode"/></label>
    <label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
    <label>Category<select value={category} onChange={e=>setCategory(e.target.value)} className="filterSelect">
      <option value="">Select category</option>
      {[...new Set([...categories, category].filter(Boolean))].map(cat => <option key={cat} value={cat}>{cat}</option>)}
    </select></label>
    <label>Quantity<input type="number" min="1" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
    {canManageCost && <label>Unit cost (R)<input type="number" min="0" step="0.01" value={unitCost} onChange={e=>setUnitCost(Number(e.target.value))}/></label>}
    <label>Product picture</label>
    <ImagePicker value={image} onChange={setImage}/>
    <button className="primary wide" disabled={!name||!expiry} onClick={()=>onSave({
      name:name.trim(), barcode:barcode.trim(), expiry, category:category.trim() || "General",
      quantity:Number(quantity)||1, unitCost:Number(unitCost)||0, image
    })}><UserCircle size={18}/> Save changes</button>
  </div></div>;
}

/**
 * Requirements 3 and 6.
 * The Activity menu holds the waste-removal history for every role, plus a store
 * performance panel for managers.
 */
function ActivityView({activities,removals,analyticsDays,storeCode,storeName,userRole,currentStaffNumber}) {
  const [pane,setPane]=useState("removals");
  const isManager = userRole === "manager";
  // Requirement 4 (new): cross-store performance figures, cached so switching
  // panes doesn't re-read the database.
  const [storePerformance,setStorePerformance]=useState(()=>readCachedStorePerformance()?.stores || []);
  const [perfBusy,setPerfBusy]=useState(false);
  const [perfError,setPerfError]=useState("");

  const loadStorePerformance = async (force=false) => {
    setPerfError("");
    const cached = readCachedStorePerformance();
    const fresh = cached && (Date.now() - Date.parse(cached.updatedAt || 0)) < STORE_PERFORMANCE_TTL_MS;
    if (!force && fresh) { setStorePerformance(cached.stores); return; }
    setPerfBusy(true);
    try { setStorePerformance(await readLiveStorePerformance()); }
    catch (error) { setPerfError(friendlyError(error)); }
    finally { setPerfBusy(false); }
  };

  useEffect(()=>{ if(pane==="stores") loadStorePerformance(); },[pane,storeCode]);

  // Requirement 3: store performance in waste removal.
  const analytics = useMemo(()=>{
    const totalRemoved = removals.length;
    const totalWasteValue = removals.reduce((sum,r)=>sum+Number(r.wasteValue||0),0);
    const overdueRemovals = removals.filter(r=>Number(r.daysOverdue||0)>0).length;
    const onTimeRemovals = totalRemoved - overdueRemovals;
    const byCategory = {};
    removals.forEach(r=>{ const k=r.category||"General"; byCategory[k]=(byCategory[k]||0)+1; });
    const byStaff = {};
    removals.forEach(r=>{ const k=r.removedByName||r.removedByStaffNumber||"Unknown"; byStaff[k]=(byStaff[k]||0)+1; });
    return {
      totalRemoved,
      totalWasteValue,
      overdueRemovals,
      onTimeRemovals,
      onTimeRate: totalRemoved ? Math.round((onTimeRemovals/totalRemoved)*100) : 0,
      categories: Object.entries(byCategory).sort((a,b)=>b[1]-a[1]),
      staff: Object.entries(byStaff).sort((a,b)=>b[1]-a[1]),
      days: analyticsDays
    };
  },[removals,analyticsDays]);

  const money = value => `R ${Number(value||0).toFixed(2)}`;

  return <section className="pageSection">
    <p className="eyebrow">STORE {storeCode ? `${storeCode}${storeName ? " \u00b7 " + storeName : ""}` : ""} {storeName?`\u00b7 ${storeName}`:""}</p>
    <h1>Activity</h1>

    <div className="filters">
      <button className={`filterSelect ${pane==="removals"?"active":""}`} onClick={()=>setPane("removals")}>Waste removed ({removals.length})</button>
      {isManager && <button className={`filterSelect ${pane==="analytics"?"active":""}`} onClick={()=>setPane("analytics")}>Store performance</button>}
      {/* Requirement 4 (new): available to every role so anyone can compare stores. */}
      <button className={`filterSelect ${pane==="stores"?"active":""}`} onClick={()=>setPane("stores")}><BarChart3 size={14}/> All store performance</button>
      {isManager && <button className={`filterSelect ${pane==="audit"?"active":""}`} onClick={()=>setPane("audit")}>Audit trail</button>}
    </div>

    {pane==="removals" && <>
      <div className="sectionHead"><div><p className="eyebrow">REMOVAL HISTORY</p><h2>Removed waste products</h2></div></div>
      {removals.length===0 ? <Empty icon={<Trash2/>} text="No products have been removed yet."/>
      : <div className="activityList">
        {removals.slice(0,200).map(item => (
          <div key={item.id} className="activityItem">
            <div className="actTime">{item.removedAtISO ? new Date(item.removedAtISO).toLocaleString() : "just now"}</div>
            <div className="actInfo">
              <strong>{item.productName}</strong>
              <span>{(item.category||"GENERAL").toUpperCase()}</span>
            </div>
            <div className="actDetails">
              {item.barcode?`${item.barcode} \u00b7 `:""}
              Expiry {item.expiry||"unknown"}
              {Number(item.daysOverdue||0)>0?` \u00b7 ${item.daysOverdue}d overdue`:" \u00b7 removed on time"}
              {` \u00b7 by ${item.removedByName||item.removedByStaffNumber||"unknown"}`}
              {` \u00b7 ${item.storeName||storeName || String()}`}
            </div>
          </div>
        ))}
      </div>}
    </>}

    {pane==="analytics" && isManager && <>
      <div className="sectionHead"><div><p className="eyebrow">STORE PERFORMANCE</p><h2>Waste removal analytics</h2></div></div>
      <section className="stats">
        <Stat icon={<Trash2/>} label="Products removed" value={analytics.totalRemoved} tone="danger"/>
        <Stat icon={<CheckCircle2/>} label="Removed on time" value={`${analytics.onTimeRate}%`} tone="blue"/>
        <Stat icon={<AlertTriangle/>} label="Removed overdue" value={analytics.overdueRemovals} tone="warning"/>
      </section>
      <div className="settingsCard">
        <label>Estimated waste value</label>
        <p className="hint">{money(analytics.totalWasteValue)} across {analytics.totalRemoved} removal(s)</p>

        <label style={{marginTop:"16px"}}>By category</label>
        {analytics.categories.length===0 ? <p className="hint">No removals recorded yet.</p>
        : <div className="categoryList">
          {analytics.categories.map(([cat,count]) => (
            <div key={cat} className="categoryItem"><span>{cat}</span><span className="hint">{count}</span></div>
          ))}
        </div>}

        <label style={{marginTop:"16px"}}>By staff member</label>
        {analytics.staff.length===0 ? <p className="hint">No removals recorded yet.</p>
        : <div className="categoryList">
          {analytics.staff.map(([name,count]) => (
            <div key={name} className="categoryItem">
              <span>{name}{name===currentStaffNumber?" (you)":""}</span><span className="hint">{count}</span>
            </div>
          ))}
        </div>}

        <label style={{marginTop:"16px"}}>Last 30 days</label>
        {analytics.days.length===0 ? <p className="hint">No daily totals recorded yet.</p>
        : <div className="categoryList">
          {analytics.days.map(day => (
            <div key={day.id} className="categoryItem">
              <span>{day.date}</span>
              <span className="hint">{day.removedCount||0} removed \u00b7 {money(day.wasteValue)}</span>
            </div>
          ))}
        </div>}
      </div>
    </>}

    {pane==="stores" && <>
      <div className="sectionHead"><div><p className="eyebrow">ALL STORES</p><h2>Store waste removal performance</h2></div>
        <button className="secondary" onClick={()=>loadStorePerformance(true)} disabled={perfBusy}><TrendingUp size={17}/> {perfBusy?"Loading...":"Refresh"}</button>
      </div>
      {perfError && <div className="error">{perfError}</div>}
      {storePerformance.length===0 && perfBusy && <p className="hint">Loading store performance...</p>}
      {storePerformance.length===0 && !perfBusy && <Empty icon={<BarChart3/>} text="No store performance recorded yet."/>}
      {storePerformance.length>0 && <div className="settingsCard">
        <StorePerformanceChart stores={storePerformance}/>
      </div>}
      {storePerformance.length>0 && <div className="activityList perfList">
        {storePerformance.map(store => (
          <div key={store.storeCode} className="activityItem">
            <div className="actTime">{store.storeCode}</div>
            <div className="actInfo">
              <strong>{store.storeName || store.storeCode}</strong>
              <span>{store.unavailable?"history unavailable":`${store.removed} removal${store.removed===1?"":"s"}`}</span>
            </div>
            <div className="actDetails">
              {store.unavailable ? (store.message || "This store's history could not be read with your access.")
                : `${store.onTime} on time \u00b7 ${store.late} late \u00b7 ${money(store.wasteValue)}`}
            </div>
          </div>
        ))}
      </div>}
      <p className="hint">Figures cover the 500 most recent removals per store. Your access is limited to your own store's live data, so other stores may show as unavailable.</p>
    </>}

    {pane==="audit" && isManager && <>
      <div className="sectionHead"><div><p className="eyebrow">AUDIT TRAIL</p><h2>User activity</h2></div></div>
      <div className="activityList">
        {activities.length === 0 ? (
          <Empty icon={<Activity/>} text="No activity recorded yet."/>
        ) : (
          activities.slice(0, 100).map(act => (
            <div key={act.id} className="activityItem">
              <div className="actTime">{new Date(act.timestamp).toLocaleString()}</div>
              <div className="actInfo">
                <strong>{act.username}</strong>
                <span>{(act.action||"").replace(/_/g, " ").toUpperCase()}</span>
              </div>
              <div className="actDetails">{act.details}</div>
            </div>
          ))
        )}
      </div>
    </>}
  </section>
}

/**
 * Requirement 4 (new).
 * A pure-CSS graph of removed on time against removed late, per store and as
 * store totals. No charting dependency, so nothing new to install or pay for.
 */
function StorePerformanceChart({stores}) {
  const visible = stores.filter(store => !store.unavailable);
  if (!visible.length) return <p className="hint">No store data available to chart.</p>;
  const totals = visible.reduce((sum,store)=>({
    onTime: sum.onTime + Number(store.onTime||0),
    late: sum.late + Number(store.late||0)
  }),{onTime:0,late:0});
  const totalRemoved = totals.onTime + totals.late;
  const percent = value => totalRemoved ? `${Math.round((value/totalRemoved)*100)}%` : "0%";

  return <div className="perfChart">
    <label>Removed on time vs removed late</label>
    <div className="perfTotals">
      <span><i className="perfDot onTime"/><em className="onTimeEm">On time: {totals.onTime}</em> ({percent(totals.onTime)})</span>
      <span><i className="perfDot late"/><em className="lateEm">Late: {totals.late}</em> ({percent(totals.late)})</span>
    </div>
    {visible.map(store=>{
      const total = Number(store.onTime||0) + Number(store.late||0);
      const onTimeWidth = total ? (store.onTime/total)*100 : 0;
      const lateWidth = total ? (store.late/total)*100 : 0;
      return <div key={store.storeCode} className="perfBarRow">
        <div className="perfRow">
          <div className="perfStore"><strong>{store.storeName || store.storeCode}</strong><span>{store.storeCode}</span></div>
          <div className="perfBars">
            <div className="perfBar" title={`${store.onTime} on time, ${store.late} late`}>
              <i className="onTime" style={{width:`${onTimeWidth}%`}}/>
              <i className="late" style={{width:`${lateWidth}%`}}/>
            </div>
            <div className="perfLegend">
              <span><i className="perfDot onTime"/>{store.onTime} on time</span>
              <span><i className="perfDot late"/>{store.late} late</span>
            </div>
          </div>
          <div className="perfStats"><strong>{store.onTimeRate}% on time</strong><span>{total} removal{total===1?"":"s"} \u00b7 R {Number(store.wasteValue||0).toFixed(2)}</span></div>
        </div>
      </div>;
    })}
  </div>;
}

function exportToCSV(products, username, onActivity) {
  const headers = ["Product Name", "Barcode", "Expiry Date", "Category", "Days Until Expiry"];
  const rows = products.map(p => [
    p.name,
    p.barcode,
    p.expiry,
    p.category,
    daysUntil(p.expiry)
  ]);

  const csvContent = [
    ["Exported by:", username],
    ["Exported at:", new Date().toLocaleString()],
    [],
    [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))]
  ].flat().join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `products_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);

  if (onActivity) onActivity("csv_exported", `Exported ${products.length} products`);
}

createRoot(document.getElementById("root")).render(<App/>);











