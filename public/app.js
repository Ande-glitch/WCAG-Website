import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD3CmO2_Lt2ZLgHAi7vG3KtykAHSUwTA18",
  authDomain: "wcag-851de.firebaseapp.com",
  projectId: "wcag-851de",
  storageBucket: "wcag-851de.firebasestorage.app",
  messagingSenderId: "102592641923",
  appId: "1:102592641923:web:a66d1bf839050764bbd4b6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser     = null;
let currentUserData = null;
let allSites        = [];
let currentSort     = "newest";
let currentSiteId   = null;
let searchQuery     = "";
let currentPage     = 1;
const PAGE_SIZE     = 9;
const votingLocks   = new Set();

// ── HELPERS ──
function isAdmin() { return currentUserData?.role === "admin"; }

// ── NAVIGATION ──
window.showPage = function(name) {
  if (name === "admin" && !isAdmin()) { toast("Ingen tilgang", "error"); return; }
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${name}`).classList.add("active");
  window.scrollTo({ top: 0 });
  if (name === "home")  loadSites();
  if (name === "admin") loadReports();
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
  document.getElementById("navAuth").style.display  = li ? "none"   : "flex";
  document.getElementById("navUser").style.display  = li ? "inline" : "none";
  document.getElementById("addLink").style.display  = li ? "inline" : "none";
  document.getElementById("adminLink").style.display = isAdmin() ? "inline" : "none";
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
  currentPage = 1;
  renderSites();
}

window.setSort = function(val) { currentSort = val; currentPage = 1; renderSites(); };

window.onSearch = function() {
  searchQuery = document.getElementById("searchInput").value.toLowerCase().trim();
  currentPage = 1;
  renderSites();
};

window.goToPage = function(p) { currentPage = p; renderSites(); window.scrollTo({ top: 0 }); };

function renderSites() {
  let list = [...allSites];
  if (searchQuery) list = list.filter(s =>
    s.name.toLowerCase().includes(searchQuery) ||
    (s.description||"").toLowerCase().includes(searchQuery) ||
    (s.url||"").toLowerCase().includes(searchQuery)
  );

  if (currentSort === "top")   list.sort((a, b) => (b.thumbsUp||0) - (a.thumbsUp||0));
  if (currentSort === "votes") list.sort((a, b) => ((b.thumbsUp||0)+(b.thumbsDown||0)) - ((a.thumbsUp||0)+(a.thumbsDown||0)));

  document.getElementById("resultCount").textContent = `${list.length} resultat${list.length !== 1 ? "er" : ""}`;

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = list.slice(start, start + PAGE_SIZE);

  const grid = document.getElementById("siteGrid");
  if (!pageItems.length) {
    grid.innerHTML = `<div class="empty">${searchQuery ? "Ingen treff på søket." : "Ingen vurderinger ennå."}</div>`;
  } else {
    grid.innerHTML = pageItems.map(s => `
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

  const pag = document.getElementById("pagination");
  if (totalPages <= 1) { pag.innerHTML = ""; return; }
  let html = "";
  if (currentPage > 1) html += `<button class="page-btn" onclick="goToPage(${currentPage-1})">← Forrige</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i===currentPage?"active":""}" onclick="goToPage(${i})">${i}</button>`;
  }
  if (currentPage < totalPages) html += `<button class="page-btn" onclick="goToPage(${currentPage+1})">Neste →</button>`;
  pag.innerHTML = html;
}

// ── SITE DETAIL ──
window.openSite = async function(siteId) {
  currentSiteId = siteId;
  showPage("detail");
  document.getElementById("siteDetail").innerHTML = `<div class="empty">Laster…</div>`;
  const snap = await getDoc(doc(db, "wcag_sites", siteId));
  if (!snap.exists()) { toast("Ikke funnet", "error"); return; }
  const s = { id: snap.id, ...snap.data() };
  const canDelete = currentUser?.uid === s.addedBy || isAdmin();

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
      ${canDelete ? `<button class="del-btn" onclick="deleteSite('${s.id}')">🗑 Slett</button>` : ""}
      ${currentUser && !isAdmin() ? `<button class="report-btn" onclick="reportContent('site','${s.id}','${esc(s.name)}','')">🚩 Rapporter</button>` : ""}
    </div>`;

  document.getElementById("commentForm").style.display    = currentUser ? "block" : "none";
  document.getElementById("commentLoginMsg").style.display = currentUser ? "none"  : "block";

  const imgInput = document.getElementById("commentImg");
  const preview  = document.getElementById("imgPreview");
  imgInput.value = "";
  preview.innerHTML = "";
  imgInput.oninput = () => {
    const v = imgInput.value.trim();
    preview.innerHTML = v ? `<img src="${esc(v)}" style="max-width:100%;max-height:160px;border-radius:6px;margin-top:4px">` : "";
  };

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
  el.innerHTML = comments.map(c => {
    const canDelete = currentUser?.uid === c.authorUid || isAdmin();
    return `
    <div class="comment-card">
      <div class="comment-name">${esc(c.authorName)}</div>
      <div class="comment-date">${formatDate(c.createdAt)}</div>
      <p class="comment-text">${esc(c.text)}</p>
      ${c.imgUrl ? `<img class="comment-img" src="${esc(c.imgUrl)}" alt="Kommentarbilde">` : ""}
      <div class="comment-actions">
        <button class="vote-btn ${myVotes[c.id]==='up'?'voted-up':''}" onclick="voteComment('${siteId}','${c.id}','up')">👍 ${c.thumbsUp||0}</button>
        <button class="vote-btn ${myVotes[c.id]==='down'?'voted-down':''}" onclick="voteComment('${siteId}','${c.id}','down')">👎 ${c.thumbsDown||0}</button>
        ${canDelete ? `<button class="del-btn" onclick="deleteComment('${siteId}','${c.id}')">🗑</button>` : ""}
        ${currentUser && !isAdmin() && currentUser.uid !== c.authorUid ? `<button class="report-btn" onclick="reportContent('comment','${c.id}','${esc(c.authorName)}','${esc(c.text.substring(0,80))}')">🚩</button>` : ""}
      </div>
    </div>`;
  }).join("");
}

window.submitComment = async function() {
  if (!currentUser) return;
  const text   = document.getElementById("commentText").value.trim();
  const imgUrl = document.getElementById("commentImg").value.trim();
  if (!text) { toast("Skriv en kommentar", "error"); return; }
  try {
    await addDoc(collection(db, "wcag_sites", currentSiteId, "comments"), {
      text, imgUrl, authorUid: currentUser.uid, authorName: currentUserData.displayName,
      createdAt: serverTimestamp(), thumbsUp: 0, thumbsDown: 0
    });
    document.getElementById("commentText").value = "";
    document.getElementById("commentImg").value  = "";
    document.getElementById("imgPreview").innerHTML = "";
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

window.deleteSite = async function(siteId) {
  if (!confirm("Slette denne vurderingen?")) return;
  try {
    await deleteDoc(doc(db, "wcag_sites", siteId));
    toast("Vurdering slettet", "success");
    showPage("home");
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

// ── REPORT ──
window.reportContent = async function(type, targetId, targetName, preview) {
  if (!currentUser) { toast("Logg inn for å rapportere", "error"); return; }
  const reason = prompt(`Hvorfor rapporterer du ${type === "site" ? "denne vurderingen" : "denne kommentaren"}?\n"${targetName}"`);
  if (reason === null) return; // cancelled
  if (!reason.trim()) { toast("Skriv en grunn", "error"); return; }
  try {
    await addDoc(collection(db, "reports"), {
      type,           // "site" | "comment"
      targetId,
      targetName,
      preview,
      siteId: currentSiteId,
      reason: reason.trim(),
      reportedBy: currentUser.uid,
      reportedByName: currentUserData.displayName,
      createdAt: serverTimestamp(),
      resolved: false
    });
    toast("Rapport sendt. Takk! ✅", "success");
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

// ── ADMIN PANEL ──
async function loadReports() {
  const el = document.getElementById("adminReports");
  el.innerHTML = `<div class="empty">Laster rapporter…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc")));
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const open = reports.filter(r => !r.resolved);
    const done = reports.filter(r => r.resolved);

    if (!reports.length) { el.innerHTML = `<div class="empty">Ingen rapporter ennå.</div>`; return; }

    const renderCard = r => `
      <div class="report-card" id="report-${r.id}">
        <span class="report-type ${r.type === 'site' ? 'report-type-site' : 'report-type-comment'}">${r.type === 'site' ? '📄 Vurdering' : '💬 Kommentar'}</span>
        <div class="report-meta">Rapportert av <strong>${esc(r.reportedByName)}</strong> · ${formatDate(r.createdAt)}</div>
        <div class="report-content">
          <strong>${esc(r.targetName)}</strong>${r.preview ? `<br><span style="color:#888">${esc(r.preview)}${r.preview.length >= 80 ? "…" : ""}</span>` : ""}
        </div>
        <div style="font-size:0.85rem;margin-bottom:10px;color:#555">Grunn: ${esc(r.reason)}</div>
        <div class="report-actions">
          ${r.type === 'site'
            ? `<button class="del-btn" onclick="adminDeleteSite('${r.siteId}','${r.id}')">🗑 Slett vurdering</button>`
            : `<button class="del-btn" onclick="adminDeleteComment('${r.siteId}','${r.targetId}','${r.id}')">🗑 Slett kommentar</button>`}
          <button class="report-resolve-btn" onclick="resolveReport('${r.id}')">✔ Merk løst</button>
        </div>
      </div>`;

    el.innerHTML =
      `<h3 style="margin-bottom:12px">Åpne rapporter (${open.length})</h3>` +
      (open.length ? open.map(renderCard).join("") : `<div class="empty" style="padding:16px">Ingen åpne rapporter.</div>`) +
      (done.length ? `<h3 style="margin:24px 0 12px">Løste rapporter (${done.length})</h3>` + done.map(r => `<div style="opacity:0.5">${renderCard(r)}</div>`).join("") : "");
  } catch (err) { el.innerHTML = `<div class="empty">Feil: ${err.message}</div>`; }
}

window.adminDeleteSite = async function(siteId, reportId) {
  if (!isAdmin()) return;
  if (!confirm("Slette denne vurderingen?")) return;
  try {
    await deleteDoc(doc(db, "wcag_sites", siteId));
    await resolveReport(reportId);
    toast("Vurdering slettet", "success");
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

window.adminDeleteComment = async function(siteId, commentId, reportId) {
  if (!isAdmin()) return;
  if (!confirm("Slette kommentaren?")) return;
  try {
    await deleteDoc(doc(db, "wcag_sites", siteId, "comments", commentId));
    await resolveReport(reportId);
    toast("Kommentar slettet", "success");
  } catch (err) { toast("Feil: " + err.message, "error"); }
};

window.resolveReport = async function(reportId) {
  try {
    await updateDoc(doc(db, "reports", reportId), { resolved: true });
    toast("Rapport merket som løst", "success");
    loadReports();
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
        await deleteDoc(vRef); await updateDoc(sRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(-1) });
      } else {
        await setDoc(vRef, { vote: dir }); await updateDoc(sRef, { thumbsUp: increment(dir==="up"?1:-1), thumbsDown: increment(dir==="down"?1:-1) });
      }
    } else {
      await setDoc(vRef, { vote: dir }); await updateDoc(sRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(1) });
    }
    const onDetail = document.getElementById("page-detail").classList.contains("active");
    if (onDetail && currentSiteId === siteId) openSite(siteId); else loadSites();
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
        await deleteDoc(vRef); await updateDoc(cRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(-1) });
      } else {
        await setDoc(vRef, { vote: dir }); await updateDoc(cRef, { thumbsUp: increment(dir==="up"?1:-1), thumbsDown: increment(dir==="down"?1:-1) });
      }
    } else {
      await setDoc(vRef, { vote: dir }); await updateDoc(cRef, { [dir==="up"?"thumbsUp":"thumbsDown"]: increment(1) });
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