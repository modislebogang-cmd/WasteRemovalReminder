import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Html5Qrcode } from "html5-qrcode";
import {
  Bell, Camera, CheckCircle2, ChevronRight, Clock3, Package,
  Plus, Search, Settings, Trash2, X, AlertTriangle, CalendarDays,
  LayoutDashboard, ScanLine, ListChecks, Download, Eye, LogOut, Activity, Filter, Store, UserCircle, ShieldCheck, Send, Save
} from "lucide-react";
import {
  firebaseEnabled, watchAuth, signInWithStaff, getStaffProfile, registerStaffMember, saveUserSettings, logOut,
  createBranch, getBranchesForUser, watchBranch, addSharedProduct,
  updateSharedProduct, addActivity, saveBranchCategories, addBranchAlert
} from "./firebase";
import "./styles.css";

const todayISO = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
};
const daysUntil = (date) => {
  const a = new Date(); a.setHours(0,0,0,0);
  const b = new Date(date); b.setHours(0,0,0,0);
  return Math.round((b-a)/86400000);
};
const initialProducts = [
  {id: "1", barcode:"6001234567890", name:"Fresh Milk 2L", expiry: todayISO(), category:"Dairy", status:"active"},
  {id: "2", barcode:"6009876543210", name:"Greek Yoghurt", expiry:new Date(Date.now()+86400000).toISOString().slice(0,10), category:"Dairy", status:"active"},
  {id: "3", barcode:"6005554443332", name:"Chicken Fillets", expiry:new Date(Date.now()+3*86400000).toISOString().slice(0,10), category:"Meat", status:"active"},
];

const defaultCategories = ["Dairy", "Meat", "Bakery", "Beverages", "Frozen", "General"];
const defaultAlertSettings = { push: false, dailySummary: true, summaryTime: "08:00", reminderDays: 1, escalateAfterHours: 4 };

function App() {
  const [products, setProducts] = useState([]);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [activities, setActivities] = useState([]);
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
  const [showStaffRegistration, setShowStaffRegistration] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) return;
    return watchAuth(async currentUser => {
      setFirebaseUser(currentUser);
      if (!currentUser) {
        setUser("");
        setUserRole("staff");
        setBranchId("");
        setBranches([]);
        setProducts([]);
        setActivities([]);
        setCategories(defaultCategories);
        setAlertSettings(defaultAlertSettings);
        return;
      }
      const profile = await getStaffProfile(currentUser.uid);
      if (profile) {
        setUser(profile.staffNumber);
        setUserRole(profile.role || "staff");
        setAlertSettings({ ...defaultAlertSettings, ...(profile.settings || {}) });
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !firebaseUser) return;
    return getBranchesForUser(firebaseUser.uid, setBranches, () => setSyncError("Could not load branches. Check your Firestore rules."));
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseEnabled || !firebaseUser || !branchId) return;
    return watchBranch(branchId, setProducts, setCategories, setActivities, () => setSyncError("Live sync is unavailable for this branch."));
  }, [firebaseUser, branchId]);

  const recordActivity = (action, details) => {
    const username = user || firebaseUser?.email || "Anonymous";
    if (firebaseEnabled && firebaseUser && branchId) {
      addActivity(branchId, { username, userId: firebaseUser.uid, action, details }).catch(() => setSyncError("Could not save activity."));
    } else {
      setSyncError("Firebase is required to save activity.");
    }
  };

  const active = products.filter(p => p.status === "active");
  const dueToday = active.filter(p => daysUntil(p.expiry) === 0);
  const expired = active.filter(p => daysUntil(p.expiry) < 0);
  const upcoming = active.filter(p => daysUntil(p.expiry) > 0 && daysUntil(p.expiry) <= 7);

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
    setProducts(ps => ps.map(p => p.id === id ? {...p, status:"removed"} : p));
    if (firebaseEnabled && firebaseUser && branchId) updateSharedProduct(branchId, id, { status: "removed" }, firebaseUser.uid).catch(() => setSyncError("Could not update product."));
    recordActivity("product_removed", `Product ID: ${id}`);
  };

  const addProduct = (data) => {
    const product = {...data, id: crypto.randomUUID(), status:"active"};
    setProducts(ps => [product, ...ps]);
    if (firebaseEnabled && firebaseUser && branchId) addSharedProduct(branchId, product, firebaseUser.uid).catch(() => setSyncError("Could not save product."));
    recordActivity("product_added", `${data.name} - ${data.category}`);
    setShowAdd(false);
  };

  if (!firebaseEnabled) return <FirebaseConfigView />;
  if (!firebaseUser || !user) return <AuthView onSignIn={async (staffNumber, phoneNumber) => { const profile = await signInWithStaff(staffNumber, phoneNumber); setUser(profile.staffNumber); setUserRole(profile.role || "staff"); }} onRegister={async (member, setupKey) => { await registerStaffMember(member, setupKey); alert("Team member registered."); }} />;
  if (firebaseEnabled && firebaseUser && !branchId) return <BranchView branches={branches} onSelect={setBranchId} onCreate={async name => {
    const branch = await createBranch(name, firebaseUser);
    setBranches(current => [...current, branch]);
    setBranchId(branch.id);
  }} onSignOut={logOut}/>;

  useEffect(() => {
    if (!user || !("Notification" in window) || !showNotifications) return;
    const due = active.filter(p => daysUntil(p.expiry) <= 0);
    if (Notification.permission === "granted" && due.length) {
      new Notification("RemoveWasteReminder", {
        body: due.length === 1 ? `${due[0].name} needs to be removed from the sales floor today.` : `${due.length} products need attention today.`
      });
    }
  }, [user, showNotifications]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandIcon"><Trash2 size={20}/></div>
          <div><strong>RemoveWaste</strong><span>Reminder</span></div>
        </div>
        <div className="topActions">
          <button className="iconBtn" onClick={async()=>{ if("Notification" in window) await Notification.requestPermission(); }} title="Enable notifications"><Bell size={19}/></button>
          <div className="roleSelector">
            <select value={userRole} onChange={e=>{setUserRole(e.target.value); recordActivity("role_changed", `Changed to ${e.target.value}`);}} className="roleSelect">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option><option value="admin">Admin</option>
            </select>
          </div>
          <button className="userChip" onClick={()=>setTab("settings")}>{(user || firebaseUser?.email || "U")[0].toUpperCase()}</button>
        </div>
      </header>

      <main className="content">
        {syncError && <div className="inAppNotification"><AlertTriangle size={20}/><div><strong>Sync notice</strong><span>{syncError}</span></div><button onClick={() => setSyncError("")} className="closeNotif"><X size={16}/></button></div>}
        {showNotifications && (dueToday.length > 0 || expired.length > 0) && (
          <div className="inAppNotification">
            <AlertTriangle size={20}/>
            <div>
              <strong>Action Required!</strong>
              <span>{dueToday.length + expired.length} product(s) need to be removed</span>
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
              <div className="productGrid">{[...expired,...dueToday].map(p=><ProductCard key={p.id} p={p} onRemove={removeProduct}/>)}</div>}
          </section>

          <section className="section">
            <div className="sectionHead"><div><p className="eyebrow">COMING UP</p><h2>Expiry watch</h2></div></div>
            {upcoming.length ? <div className="productGrid">{upcoming.slice(0,4).map(p=><ProductCard key={p.id} p={p}/>)}</div> : <Empty icon={<CalendarDays/>} text="No upcoming expiries in the next 7 days."/>}
          </section>
        </>}

        {tab === "products" && <section className="pageSection">
          <div className="pageTitle">
            <div><p className="eyebrow">INVENTORY</p><h1>Tracked products</h1></div>
            <div style={{display:"flex",gap:"10px"}}>
              <button className="primary" onClick={()=>setShowScanner(true)}><ScanLine size={18}/> Scan product</button>
              {(userRole === "manager" || userRole === "admin") && <button className="secondary" onClick={() => exportToCSV(filtered, user, recordActivity)}><Download size={18}/> Export CSV</button>}
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
          <div className="productGrid">{filtered.length ? filtered.map(p=><ProductCard key={p.id} p={p} onRemove={removeProduct} userRole={userRole}/>) : <Empty icon={<Package/>} text="No products match your filters."/>}</div>
        </section>}

        {tab === "settings" && <section className="pageSection narrow">
          <p className="eyebrow">ACCOUNT</p><h1>Settings</h1>
          <div className="settingsCard">
            <label>Registered user / team name</label>
            <input value={user} readOnly placeholder="Staff number"/>
            {firebaseEnabled && firebaseUser && <>
              <label>Account email</label><p className="hint">{firebaseUser.email}</p>
              <button className="secondary wide" onClick={async()=>{await updateUserProfile(firebaseUser,{displayName:user}); recordActivity("profile_updated", "Updated display name");}}><UserCircle size={18}/> Save profile</button>
              <button className="textBtn" onClick={logOut}><LogOut size={16}/> Sign out</button>
            </>}
            <label>User Role</label>
            <select value={userRole} onChange={e=>setUserRole(e.target.value)} className="roleSelect">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option><option value="admin">Admin</option>
            </select>
            {(userRole === "manager" || userRole === "admin") && (
              <>
                <label style={{marginTop:"20px"}}>Manage Categories</label>
                <div className="categoryList">
                  {categories.map(cat => (
                    <div key={cat} className="categoryItem">
                      <span>{cat}</span>
                      <button onClick={() => {const next = categories.filter(c => c !== cat); setCategories(next); if(firebaseEnabled && branchId) saveBranchCategories(branchId, next);}} className="removeBtn" style={{padding:"4px 8px"}}><Trash2 size={16}/></button>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex", gap:"10px", marginTop:"10px"}}>
                  <input type="text" id="newCat" placeholder="New category" style={{flex:1, padding:"8px"}}/>
                  <button onClick={() => {const el = document.getElementById("newCat"); if(el.value) { const next = [...categories, el.value]; setCategories(next); if(firebaseEnabled && branchId) saveBranchCategories(branchId, next); el.value = ""; }}} className="secondary">Add</button>
                </div>
              </>
            )}
            <AlertSettings settings={alertSettings} onChange={setAlertSettings} onRequestPush={async()=>{if("Notification" in window){const permission=await Notification.requestPermission();setAlertSettings(current=>({...current,push:permission === "granted"}))}}} onSave={async next=>{if(user) await saveUserSettings(user,next);recordActivity("alert_settings_updated","Updated alert preferences")}} onEscalate={async message=>{if(firebaseEnabled && firebaseUser && branchId) await addBranchAlert(branchId,{message,from:user,type:"manager_escalation",status:"open"});recordActivity("manager_escalation",message)}} />
            <p className="hint">Staff can scan products and manage removals. Managers can view activity, export reports, and manage categories.</p>
          </div>
        </section>}

        {tab === "activity" && (userRole === "manager" || userRole === "admin") && <ActivityView activities={activities}/>} 
      </main>

      <nav className="bottomNav">
        <NavItem active={tab==="dashboard"} icon={<LayoutDashboard/>} text="Dashboard" onClick={()=>setTab("dashboard")}/>
        <NavItem active={tab==="products"} icon={<ListChecks/>} text="Products" onClick={()=>setTab("products")}/>
        <NavItem active={false} icon={<ScanLine/>} text="Scan" primary onClick={()=>setShowScanner(true)}/>
        {(userRole === "manager" || userRole === "admin") && <NavItem active={tab==="activity"} icon={<Activity/>} text="Activity" onClick={()=>setTab("activity")}/>}
        <NavItem active={tab==="settings"} icon={<Settings/>} text="Settings" onClick={()=>setTab("settings")}/>
      </nav>

      {showScanner && <ScannerModal onClose={()=>setShowScanner(false)} onScanned={(code)=>{setEditingBarcode(code);setShowScanner(false);setShowAdd(true)}}/>}
      {showAdd && <AddModal barcode={editingBarcode} onClose={()=>setShowAdd(false)} onSave={addProduct}/>}
    </div>
  );
}

function FirebaseConfigView() {
  return <div className="modalBackdrop"><div className="modal"><p className="eyebrow">SECURE ACCESS</p><h2>Firebase configuration required</h2><p className="hint">Add the VITE_FIREBASE environment variables, then reload the app to sign in with your staff number and phone number.</p></div></div>;
}

function AuthView({onSignIn,onRegister}) {
  const [staffNumber,setStaffNumber]=useState(""); const [phoneNumber,setPhoneNumber]=useState(""); const [storeCode,setStoreCode]=useState(""); const [storeName,setStoreName]=useState(""); const [role,setRole]=useState("staff"); const [setupKey,setSetupKey]=useState(""); const [register,setRegister]=useState(false); const [error,setError]=useState("");
  const submit=async e=>{e.preventDefault();setError("");if(!window.confirm("This is a private app made by Woolworths staff and is only for Woolworths. MADE WITH LOVE USING AI BY YOURDEVLEBO"))return;try{if(register){await onRegister({staffNumber,phoneNumber,storeCode,storeName,role},setupKey);setRegister(false)}else await onSignIn(staffNumber,phoneNumber)}catch(err){setError(err.message||"Could not verify those details.")}};
  return <div className="modalBackdrop"><div className="modal"><p className="eyebrow">SECURE ACCESS</p><h2>{register?"Register team member":"Staff sign in"}</h2><form onSubmit={submit}><label>Staff number<input value={staffNumber} onChange={e=>setStaffNumber(e.target.value)} required/></label><label>Phone number<input type="tel" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} required/></label>{register&&<><label>Store code<input value={storeCode} onChange={e=>setStoreCode(e.target.value)} required/></label><label>Store name<input value={storeName} onChange={e=>setStoreName(e.target.value)} required/></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)} className="filterSelect"><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><label>Admin setup key<input type="password" value={setupKey} onChange={e=>setSetupKey(e.target.value)} required/></label></>}{error&&<div className="error">{error}</div>}<button className="primary wide" type="submit"><ShieldCheck size={18}/>{register?"Register member":"Verify and sign in"}</button></form><button className="textBtn" onClick={()=>setRegister(!register)}>{register?"Back to staff sign in":"Admin registration"}</button></div></div>;
}
function AlertSettings({settings,onChange,onRequestPush,onSave,onEscalate}) {
  const [message,setMessage]=useState("");
  return <div className="phase4Settings"><label><input type="checkbox" checked={settings.push} onChange={onRequestPush}/> Push notifications</label><label><input type="checkbox" checked={settings.dailySummary} onChange={e=>onChange({...settings,dailySummary:e.target.checked})}/> Daily summary alerts</label>{settings.dailySummary&&<label>Summary time<input type="time" value={settings.summaryTime} onChange={e=>onChange({...settings,summaryTime:e.target.value})}/></label>}<label>Alert lead time in days<input type="number" min="0" max="7" value={settings.reminderDays} onChange={e=>onChange({...settings,reminderDays:Number(e.target.value)})}/></label><label>Escalate after hours<input type="number" min="1" max="48" value={settings.escalateAfterHours} onChange={e=>onChange({...settings,escalateAfterHours:Number(e.target.value)})}/></label><button className="secondary wide" onClick={()=>onSave(settings)}><Save size={18}/> Save alert settings</button><label>Message for manager<input value={message} onChange={e=>setMessage(e.target.value)} placeholder="What needs manager attention?"/></label><button className="secondary wide" disabled={!message.trim()} onClick={()=>{onEscalate(message.trim());setMessage("")}}><Send size={18}/> Escalate to manager</button></div>;
}

function StaffRegistrationModal({onClose,onRegister}) {
  const [staffNumber,setStaffNumber]=useState(""); const [phoneNumber,setPhoneNumber]=useState(""); const [storeCode,setStoreCode]=useState(""); const [storeName,setStoreName]=useState(""); const [role,setRole]=useState("staff"); const [setupKey,setSetupKey]=useState(""); const [error,setError]=useState("");
  const submit=async event=>{event.preventDefault();setError("");try{await onRegister({staffNumber,phoneNumber,storeCode,storeName,role},setupKey)}catch(err){setError(err.message||"Could not register this staff member.")}};
  return <div className="modalBackdrop"><div className="modal"><button className="close" onClick={onClose}><X/></button><p className="eyebrow">ADMINISTRATION</p><h2>Register staff member</h2><form onSubmit={submit}><label>Staff number<input value={staffNumber} onChange={e=>setStaffNumber(e.target.value)} required/></label><label>Phone number<input type="tel" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} required/></label><label>Store code<input value={storeCode} onChange={e=>setStoreCode(e.target.value)} required/></label><label>Store name<input value={storeName} onChange={e=>setStoreName(e.target.value)} required/></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)} className="filterSelect"><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><label>Admin setup key<input type="password" value={setupKey} onChange={e=>setSetupKey(e.target.value)} required/></label>{error&&<div className="error">{error}</div>}<button className="primary wide" type="submit"><ShieldCheck size={18}/> Register member</button></form></div></div>;
}

function BranchView({branches,onSelect,onCreate,onSignOut}) {
  const [name,setName]=useState("");
  return <div className="modalBackdrop"><div className="modal"><p className="eyebrow">STORE MANAGEMENT</p><h2>Select a branch</h2>{branches.map(branch=><button key={branch.id} className="secondary wide" onClick={()=>onSelect(branch.id)}><Store size={18}/>{branch.name}</button>)}<form onSubmit={e=>{e.preventDefault(); if(name.trim()) {onCreate(name.trim());setName("");}}}><label>New branch name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Main Street"/></label><button className="primary wide" type="submit"><Plus size={18}/> Create branch</button></form><button className="textBtn" onClick={onSignOut}><LogOut size={16}/> Sign out</button></div></div>;
}

function Stat({icon,label,value,tone}) {
  return <div className={`stat ${tone}`}><div className="statIcon">{React.cloneElement(icon,{size:19})}</div><div><strong>{value}</strong><span>{label}</span></div></div>
}
function NavItem({active,icon,text,onClick,primary}) {
  return <button className={`navItem ${active?"active":""} ${primary?"navPrimary":""}`} onClick={onClick}>{icon}<span>{text}</span></button>
}
function Empty({icon,text}) { return <div className="empty">{icon}<span>{text}</span></div> }

function ProductCard({p,onRemove,userRole}) {
  const d=daysUntil(p.expiry);
  const urgency=d<0?"expired":d===0?"today":d<=2?"soon":"normal";
  return <div className={`productCard ${urgency}`}>
    <div className="productIcon"><Package size={22}/></div>
    <div className="productInfo"><strong>{p.name}</strong><span>{p.category || "General"} Â· {p.barcode}</span></div>
    <div className="expiry"><span>{d<0?`${Math.abs(d)}d overdue`:d===0?"REMOVE TODAY":`${d}d left`}</span><b>{new Date(p.expiry).toLocaleDateString()}</b></div>
    {(onRemove && (userRole === "staff" || userRole === "manager")) && <button className="removeBtn" onClick={()=>onRemove(p.id)} title="Mark removed"><CheckCircle2 size={19}/></button>}
  </div>
}

function ScannerModal({onClose,onScanned}) {
  const scannerRef=useRef(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const scanner = new Html5Qrcode("barcode-reader");
    scannerRef.current=scanner;
    scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:140}},
      async text=>{ try{await scanner.stop()}catch{} onScanned(text) },
      ()=>{}
    ).catch(e=>setError("Camera access was blocked. Allow camera permission or add the barcode manually."));
    return ()=>{ if(scannerRef.current?.isScanning) scannerRef.current.stop().catch(()=>{}); };
  },[]);
  return <div className="modalBackdrop"><div className="modal scannerModal">
    <button className="close" onClick={onClose}><X/></button><p className="eyebrow">BARCODE SCANNER</p><h2>Scan product</h2>
    <div id="barcode-reader"></div>
    {error && <div className="error">{error}</div>}
    <p className="hint">Point your phone camera at the product barcode. EAN-13, EAN-8, UPC and other common retail codes are supported by the scanner library.</p>
  </div></div>
}

function AddModal({barcode,onClose,onSave}) {
  const [name,setName]=useState(""); const [expiry,setExpiry]=useState(""); const [category,setCategory]=useState("");
  return <div className="modalBackdrop"><div className="modal">
    <button className="close" onClick={onClose}><X/></button><p className="eyebrow">PRODUCT DETAILS</p><h2>Register product</h2>
    <label>Product name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Fresh Milk 2L"/></label>
    <label>Barcode<input value={barcode} readOnly/></label>
    <label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
    <label>Category<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Dairy"/></label>
    <button className="primary wide" disabled={!name||!expiry} onClick={()=>onSave({name,barcode,expiry,category})}><Bell size={18}/> Save & remind me</button>
  </div></div>
}

function ActivityView({activities}) {
  return <section className="pageSection">
    <p className="eyebrow">AUDIT TRAIL</p><h1>User Activity</h1>
    <div className="activityList">
      {activities.length === 0 ? (
        <Empty icon={<Activity/>} text="No activity recorded yet."/>
      ) : (
        activities.slice(0, 100).map(act => (
          <div key={act.id} className="activityItem">
            <div className="actTime">{new Date(act.timestamp).toLocaleString()}</div>
            <div className="actInfo">
              <strong>{act.username}</strong>
              <span>{act.action.replace(/_/g, " ").toUpperCase()}</span>
            </div>
            <div className="actDetails">{act.details}</div>
          </div>
        ))
      )}
    </div>
  </section>
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











