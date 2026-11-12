// ============================================================
// GENZURA · shared helpers
// ============================================================

export const db = firebase.firestore();
export const auth = firebase.auth();

export const state = { uid: null, profile: null };
export const bus = new EventTarget();

/* ---------- auth ---------- */
export function initAuth() {
    return new Promise((resolve) => {
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                location.replace('index.html');
                return;
            }
            state.uid = user.uid;
            try {
                const snap = await db.collection('users').doc(user.uid).get();
                state.profile = snap.exists ? snap.data() : {};
            } catch (err) {
                console.warn('Profile read failed', err);
                state.profile = {};
            }
            resolve(user);
        });
    });
}

/* ---------- formatters ---------- */
const nf = new Intl.NumberFormat('en-US');
const nfMoney = (n) => 'RWF ' + nf.format(Math.round(Number(n) || 0));

export const fmtMoney = nfMoney;
export const fmtNum = (n) => nf.format(Math.round(Number(n) || 0));
export const fmtPct = (n) => (Number(n) || 0).toFixed(1) + '%';

/* ---------- escaping (XSS) ---------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/* ---------- dates ---------- */
/** Accepts Firestore Timestamp, {seconds}, YYYY-MM-DD string, ISO string, Date. */
export function parseDateValue(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v === 'object' && v.seconds != null) return new Date(v.seconds * 1000);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00');
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

export function isoDate(d = new Date()) {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 10);
}

export function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

export function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

export function fmtDate(v, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
    const d = parseDateValue(v);
    return d ? d.toLocaleDateString('en-US', opts) : '—';
}

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(message, type = 'info') {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.className = 'toast ' + type;
    el.textContent = message;
    // force reflow so transition replays
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- modals ---------- */
export function openModal(id) { document.getElementById(id)?.classList.add('open'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) { closer.closest('.modal')?.classList.remove('open'); return; }
    if (e.target.classList.contains('modal') && e.target.dataset.static !== 'true') {
        e.target.classList.remove('open');
    }
});

/* ---------- confirm ---------- */
export function confirmDialog({
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    danger = false,
} = {}) {
    return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'modal open';
        wrap.innerHTML = `
      <div class="modal-card modal-sm">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3></div>
        <div class="modal-body"><p class="muted">${escapeHtml(message)}</p></div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-x="0" type="button">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="1" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
        document.body.appendChild(wrap);
        wrap.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-x]');
            if (e.target === wrap || btn) {
                const ok = !!btn && btn.dataset.x === '1';
                wrap.remove();
                resolve(ok);
            }
        });
    });
}

/* ---------- misc ---------- */
export function debounce(fn, ms = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function emitChange(source) {
    bus.dispatchEvent(new CustomEvent('data:changed', { detail: { source } }));
}