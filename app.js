import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB1tm8rq_bKvGknx9rzStR-wOp6NCxr5ME",
  authDomain: "biblo-c7c39.firebaseapp.com",
  projectId: "biblo-c7c39",
  storageBucket: "biblo-c7c39.firebasestorage.app",
  messagingSenderId: "107914063600",
  appId: "1:107914063600:web:1e4164a38774b4ee9a1c35",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser     = null;
let currentUserData = null;
let allSites        = [];
let currentSort     = "newest";
let currentSiteId   = null;
const votingLocks   = new Set();

// ── NAVIGATION ──
window.showPage = function(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${name}`).classList.add("active");
  window.scrollTo({ top: 0 });
  if (name === "home") loadSites();
  if (name === "add" && !currentUser) { showPage("login"); toast("Logg inn først", "error"); }
};

// ── AUTH ──
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentUserData = snap.exists() ? snap.data() : null;
  } else { currentUserData = null; }
  updateNav();
});

function updateNav() {
  const li = !!currentUser;
  document.getElementById("navAuth").style.display = li ? "none"   : "flex";
  document.getElementById("navUser").style.display = li ? "inline" : "none";
  document.getElementById("addLink").style.display = li ? "inline" : "none";
  if (li && currentUserData) document.getElementById("navName").textContent = currentUserData.displayName;
}

window.registerUser = async function(e) {
  e.preventDefault();
  const btn = document.getElementById("registerBtn");
  btn.disabled = true; btn.textContent = "Oppretter…";
  try {
    const name = document.getElementById("regName").value.trim();
    const cred = await createUserWithEmailAndPassword(auth, document.getElementById("regEmail").value.trim(), document.getElementById("regPassword").value);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { uid: cred.user.uid, displayName: name, email: cred.user.email, createdAt: serverTimestamp() });
    currentUserData = { displayName: name };
    updateNav();
    toast("Konto opprettet! 🎉", "success"); showPage("home");
  } catch (err) { toast(fbErr(err.code), "error"); }
  finally { btn.disabled = false; btn.textContent = "Opprett konto"; }
};

window.loginUser = async function(e) {
  e.preventDefault();
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Logger inn…";
  try {
    await signInWithEmailAndPassword(auth, document.getElementById("loginEmail").value.trim(), document.getElementById("loginPassword").value);
    toast("Velkommen tilbake!", "success"); showPage("home");
  } catch (err) { toast(fbErr(err.code), "error"); }
  finally { btn.disabled = false; btn.textContent = "Logg inn"; }
};

window.logOut = async function() { await signOut(auth); toast("Logget ut"); showPage("home"); };

// ── SITES LIST ──
async function loadSites() {
  document.getElementById("siteGrid").innerHTML = `<div class="empty">Laster…</div>`;
  const snap = await getDocs(query(collection(db, "wcag_sites"), orderBy("createdAt", "desc")));
  allSites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSites();
}

window.setSort = function(val) { currentSort = val; renderSites(); };

function renderSites() {
  let list = [...allSites];
  if (currentSort === "top")   list.sort((a, b) => (b.thumbsUp||0) - (a.thumbsUp||0));
  if (currentSort === "votes") list.sort((a, b) => ((b.thumbsUp||0)+(b.thumbsDown||0)) - ((a.thumbsUp||0)+(a.thumbsDown||0)));
  const grid = document.getElementById("siteGrid");
  if (!list.length) { grid.innerHTML = `<div class="empty">Ingen vurderinger ennå.</div>`; return; }
  grid.innerHTML = list.map(s => `
    <div class="site-card" onclick="openSite('${s.id}')">
      ${s.imgUrl ? `<img class="site-img" src="${esc(s.imgUrl)}" alt="${esc(s.name)}">` : `<div class="site-img-placeholder">🌐</div>`}
      <div class="site-body">
        <span class="site-badge ${badge(s.rating)}">WCAG ${esc(s.rating)}</span>
        <div class="site-name">${esc(s.name)}</div>
        <div class="site-desc">${esc(s.description)}</div>
        <div class="site-by">Vurdert av ${esc(s.addedByName)}</div>
        <div class="site-actions" onclick="event.stopPropagation()">
          <a class="visit-btn" href="${esc(s.url)}" target="_blank">🔗 Besøk</a>
          <button class="vote-btn" onclick="voteSite('${s.id}','up')">👍 ${s.thumbsUp||0}</button>
          <button class="vote-btn" onclick="voteSite('${s.id}','down')">👎 ${s.thumbsDown||0}</button>
        </div>
      </div>
    </div>`).join("");
}

// ── SITE DETAIL ──
window.openSite = async function(siteId) {
  currentSiteId = siteId;
  showPage("detail");
  document.getElementById("siteDetail").innerHTML = `<div class="empty">Laster…</div>`;
  const snap = await getDoc(doc(db, "wcag_sites", siteId));
  if (!snap.exists()) { toast("Ikke funnet", "error"); return; }
  const s = { id: snap.id, ...snap.data() };

  const isOwner = currentUser?.uid === s.addedBy;
  document.getElementById("siteDetail").innerHTML = `
    ${s.imgUrl ? `<img class="detail-img" src="${esc(s.imgUrl)}" alt="${esc(s.name)}">` : `<div class="detail-img-placeholder">🌐</div>`}
    <span class="site-badge ${badge(s.rating)}">WCAG ${esc(s.rating)}</span>
    <div class="detail-name">${esc(s.name)}</div>
    <div class="detail-by">Vurdert av ${esc(s.addedByName)}</div>
    <p class="detail-desc">${esc(s.description)}</p>
    <div class="detail-actions">
      <a class="visit-btn" href="${esc(s.url)}" target="_blank">🔗 Besøk nettsted</a>
      <button class="vote-btn" onclick="voteSite('${s.id}','up')">👍 ${s.thumbsUp||0}</button>
      <button class="vote-btn" onclick="voteSite('${s.id}','down')">👎 ${s.thumbsDown||0}</button>
      ${isOwner ? `<button class="del-btn" onclick="deleteSite('${s.id}')">🗑 Slett</button>` : ""}
    </div>`;

  // Comments
  document.getElementById("commentForm").style.display = currentUser ? "block" : "none";
  document.getElementById("commentLoginMsg").style.display = currentUser ? "none" : "block";
  loadComments(siteId);
};

// ── COMMENTS ──
async function loadComments(siteId) {
  const snap = await getDocs(query(collection(db, "wcag_sites", siteId, "comments"), orderBy("createdAt", "desc")));
  const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let myVotes = {};
  if (currentUser) {
    for (const c of comments) {
      try {
        const v = await getDoc(doc(db, "wcag_sites", siteId, "comments", c.id, "votes", currentUser.uid));
        if (v.exists()) myVotes[c.id] = v.data().vote;
      } catch {}
    }
  }

  const el = document.getElementById("commentsList");
  if (!comments.length) { el.innerHTML = `<div class="empty">Ingen kommentarer ennå.</div>`; return; }
  el.innerHTML = comments.map(c => `
    <div class="comment-card">
      <div class="comment-name">${esc(c.authorName)}</div>
      <div class="comment-date">${formatDate(c.createdAt)}</div>
      <p class="comment-text">${esc(c.text)}</p>
      <div class="comment-actions">
        <button class="vote-btn ${myVotes[c.id]==='up'?'voted-up':''}" onclick="voteComment('${siteId}','${c.id}','up')">👍 ${c.thumbsUp||0}</button>
        <button class="vote-btn ${myVotes[c.id]==='down'?'voted-down':''}" onclick="voteComment('${siteId}','${c.id}','down')">👎 ${c.thumbsDown||0}</button>
        ${currentUser?.uid === c.authorUid ? `<button class="del-btn" onclick="deleteComment('${siteId}','${c.id}')">🗑</button>` : ""}
      </div>
    </div>`).join("");
}

window.submitComment = async function() {
  if (!currentUser) return;
  const text = document.getElementById("commentText").value.trim();
  if (!text) { toast("Skriv en kommentar", "error"); return; }
  try {
    await addDoc(collection(db, "wcag_sites", currentSiteId, "comments"), {
      text, authorUid: currentUser.uid, authorName: currentUserData.displayName,
      createdAt: serverTimestamp(), thumbsUp: 0, thumbsDown: 0
    });
    document.getElementById("commentText").value = "";
    toast("Kommentar lagt til!", "success");
    loadComments(currentSiteId);
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

window.deleteComment = async function(siteId, commentId) {
  if (!confirm("Slette kommentaren?")) return;
  try {
    await deleteDoc(doc(db, "wcag_sites", siteId, "comments", commentId));
    toast("Kommentar slettet", "success");
    loadComments(siteId);
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

// ── DELETE SITE ──
window.deleteSite = async function(siteId) {
  if (!confirm("Slette denne vurderingen?")) return;
  try {
    await deleteDoc(doc(db, "wcag_sites", siteId));
    toast("Vurdering slettet", "success");
    showPage("home");
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

// ── VOTE SITE ──
window.voteSite = async function(siteId, dir) {
  if (!currentUser) { toast("Logg inn for å stemme", "error"); return; }
  if (votingLocks.has(siteId)) return;
  votingLocks.add(siteId);
  const vRef = doc(db, "wcag_sites", siteId, "votes", currentUser.uid);
  const sRef = doc(db, "wcag_sites", siteId);
  try {
    const ex = await getDoc(vRef);
    if (ex.exists()) {
      if (ex.data().vote === dir) {
        await deleteDoc(vRef);
        await updateDoc(sRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(-1) });
      } else {
        await setDoc(vRef, { vote: dir });
        await updateDoc(sRef, { thumbsUp: increment(dir==="up"?1:-1), thumbsDown: increment(dir==="down"?1:-1) });
      }
    } else {
      await setDoc(vRef, { vote: dir });
      await updateDoc(sRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(1) });
    }
    loadSites();
    if (currentSiteId === siteId) openSite(siteId);
  } catch (err) { toast("Feil: " + err.message, "error"); }
  finally { votingLocks.delete(siteId); }
};

// ── VOTE COMMENT ──
window.voteComment = async function(siteId, commentId, dir) {
  if (!currentUser) { toast("Logg inn for å stemme", "error"); return; }
  if (votingLocks.has(commentId)) return;
  votingLocks.add(commentId);
  const vRef = doc(db, "wcag_sites", siteId, "comments", commentId, "votes", currentUser.uid);
  const cRef = doc(db, "wcag_sites", siteId, "comments", commentId);
  try {
    const ex = await getDoc(vRef);
    if (ex.exists()) {
      if (ex.data().vote === dir) {
        await deleteDoc(vRef);
        await updateDoc(cRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(-1) });
      } else {
        await setDoc(vRef, { vote: dir });
        await updateDoc(cRef, { thumbsUp: increment(dir==="up"?1:-1), thumbsDown: increment(dir==="down"?1:-1) });
      }
    } else {
      await setDoc(vRef, { vote: dir });
      await updateDoc(cRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(1) });
    }
    loadComments(siteId);
  } catch (err) { toast("Feil: " + err.message, "error"); }
  finally { votingLocks.delete(commentId); }
};

// ── ADD SITE ──
window.submitSite = async function(e) {
  e.preventDefault();
  if (!currentUser) return;
  const btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Lagrer…";
  try {
    await addDoc(collection(db, "wcag_sites"), {
      name:        document.getElementById("siteName").value.trim(),
      url:         document.getElementById("siteUrl").value.trim(),
      imgUrl:      document.getElementById("siteImg").value.trim(),
      rating:      document.getElementById("siteRating").value,
      description: document.getElementById("siteDesc").value.trim(),
      addedBy:     currentUser.uid,
      addedByName: currentUserData.displayName,
      createdAt:   serverTimestamp(),
      thumbsUp: 0, thumbsDown: 0
    });
    toast("Nettsted lagt til! ✅", "success"); e.target.reset(); showPage("home");
  } catch (err) { toast("Feil: " + err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Legg til"; }
};

// ── UTILS ──
function badge(r) { return r==="AAA"?"badge-AAA":r==="AA"?"badge-AA":r==="A"?"badge-A":"badge-fail"; }
function esc(s) { if (!s) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function formatDate(ts) { if (!ts) return ""; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString("no-NO", { day:"numeric", month:"long", year:"numeric" }); }
function fbErr(code) { return {"auth/email-already-in-use":"E-post er allerede i bruk","auth/invalid-email":"Ugyldig e-post","auth/weak-password":"For svakt passord","auth/invalid-credential":"Feil e-post eller passord","auth/too-many-requests":"For mange forsøk"}[code]||"En feil oppstod"; }
let toastTimer;
window.toast = function(msg, type="") { const el=document.getElementById("toast"); el.textContent=msg; el.className=`show ${type}`; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.className="";},3500); };

document.addEventListener("DOMContentLoaded", () => showPage("home"));