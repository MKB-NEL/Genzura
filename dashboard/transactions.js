import {
    db, state, toast, escapeHtml, fmtMoney, fmtNum,
    parseDateValue, isoDate, fmtDate,
    confirmDialog, openModal, closeModal, debounce, emitChange,
} from './shared.js';
import { ensureStock } from './stock.js';

let sold = [];
let loans = [];
let suppliers = [];
let loaded = false;
let els = null;
let currentLoanFilter = 'all';

const $ = (s, r = document) => r.querySelector(s);

export async function initTransactions() {
    els = {
        soldSearch: $('#soldSearch'),
        supplierSearch: $('#supplierSearch'),
        recordSaleBtn: $('#recordSaleBtn'),
        addLoanBtn: $('#addLoanBtn'),
        addSupplierBtn: $('#addSupplierBtn'),

        soldList: $('#soldList'),
        loanList: $('#loanList'),
        supplierList: $('#supplierList'),

        saleForm: $('#saleForm'),
        saleProduct: $('#saleProduct'),
        saleQty: $('#saleQty'),
        salePrice: $('#salePrice'),
        saleDate: $('#saleDate'),
        saleHint: $('#saleHint'),
        saleSubmit: $('#saleSubmit'),

        loanForm: $('#loanForm'),
        loanModalTitle: $('#loanModalTitle'),
        loanId: $('#loanId'),
        loanName: $('#loanName'),
        loanProduct: $('#loanProduct'),
        loanAmount: $('#loanAmount'),
        loanDate: $('#loanDate'),
        loanDue: $('#loanDue'),

        supplierForm: $('#supplierForm'),
        supplierModalTitle: $('#supplierModalTitle'),
        supplierId: $('#supplierId'),
        supplierName: $('#supplierName'),
        supplierPhone: $('#supplierPhone'),
        supplierTin: $('#supplierTin'),
        supplierProducts: $('#supplierProducts'),
    };

    // sub-tabs
    document.querySelectorAll('#txSubTabs .sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#txSubTabs .sub-tab').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            document.querySelectorAll('.sub-panel').forEach(p => {
                p.classList.toggle('is-active', p.dataset.sub === btn.dataset.sub);
            });
        });
    });

    // loan filter
    document.querySelectorAll('#loanFilter .range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#loanFilter .range-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            currentLoanFilter = btn.dataset.filter;
            renderLoans();
        });
    });

    // modals
    els.recordSaleBtn.addEventListener('click', openSaleForm);
    els.addLoanBtn.addEventListener('click', () => openLoanForm());
    els.addSupplierBtn.addEventListener('click', () => openSupplierForm());

    els.saleProduct.addEventListener('change', updateSaleHint);
    els.saleQty.addEventListener('input', updateSaleHint);
    els.saleForm.addEventListener('submit', onSubmitSale);
    els.loanForm.addEventListener('submit', onSubmitLoan);
    els.supplierForm.addEventListener('submit', onSubmitSupplier);

    els.soldSearch.addEventListener('input', debounce(renderSold, 180));
    els.supplierSearch.addEventListener('input', debounce(renderSuppliers, 180));

    els.loanList.addEventListener('click', onLoanAction);
    els.supplierList.addEventListener('click', onSupplierAction);

    await refreshTransactions();
    loaded = true;
}

export async function refreshTransactions() {
    const [soldSnap, loansSnap, suppliersSnap] = await Promise.all([
        db.collection('sold').where('userId', '==', state.uid).get(),
        db.collection('loans').where('userId', '==', state.uid).get(),
        db.collection('suppliers').where('userId', '==', state.uid).get(),
    ]);

    sold = soldSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    suppliers = suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    sold.sort((a, b) => sortKey(b) - sortKey(a));
    loans.sort((a, b) => sortKey(b) - sortKey(a));
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    renderSold();
    renderLoans();
    renderSuppliers();
}

function sortKey(o) {
    const d = parseDateValue(o.recordedAt) || parseDateValue(o.createdAt) || parseDateValue(o.saleDate);
    return d ? d.getTime() : 0;
}

/* ============================================================
   SALES
   ============================================================ */
function renderSold() {
    if (!els) return;
    const q = els.soldSearch.value.trim().toLowerCase();
    const list = q
        ? sold.filter(s =>
            (s.productName || '').toLowerCase().includes(q) ||
            String(s.totalAmount || '').includes(q))
        : sold;

    if (!list.length) {
        els.soldList.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i><p>${sold.length ? 'No matching sales.' : 'No sales recorded yet.'}</p></div>`;
        return;
    }

    els.soldList.innerHTML = list.map(s => {
        const qty = Number(s.quantity) || 0;
        const price = Number(s.price) || 0;
        const total = Number(s.totalAmount) || qty * price;
        const when = s.saleDate || fmtDate(s.recordedAt, { month: 'short', day: 'numeric', year: 'numeric' });
        return `
      <article class="row-card">
        <div class="rc-icon success"><i class="fas fa-cash-register"></i></div>
        <div class="rc-body">
          <div class="rc-top">
            <h4>${escapeHtml(s.productName || 'Sale')}</h4>
            <span class="rc-amount">${fmtMoney(total)}</span>
          </div>
          <div class="rc-meta">
            <span>${fmtNum(qty)} × ${fmtMoney(price)}</span>
            <span>·</span>
            <span>${escapeHtml(when)}</span>
          </div>
        </div>
      </article>`;
    }).join('');
}

async function openSaleForm() {
    const products = await ensureStock();
    const available = products.filter(p => (Number(p.quantity) || 0) > 0);

    if (!available.length) {
        toast('No stock available to sell', 'error');
        return;
    }

    els.saleProduct.innerHTML = available.map(p =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${fmtNum(p.quantity)} left</option>`
    ).join('');

    els.saleForm.reset();
    els.saleDate.value = isoDate();
    els.saleProduct.value = available[0].id;
    updateSaleHint();
    openModal('saleModal');
}

function updateSaleHint() {
    const products = window.__genzuraStock || [];
    // find by looking up in the select text if needed — simpler: keep a map
    // We avoid a second fetch: parse quantity from option label is fragile,
    // so use the cached list from stock.js
    import('./stock.js').then(({ getStock }) => {
        const stock = getStock();
        const p = stock.find(x => x.id === els.saleProduct.value);
        if (!p) { els.saleHint.textContent = ''; return; }
        const qty = Number(els.saleQty.value) || 0;
        const avail = Number(p.quantity) || 0;
        const uc = Number(p.unitCost) || (p.quantity > 0 ? Number(p.cost) / Number(p.quantity) : 0);
        els.saleQty.max = String(avail);
        els.saleHint.textContent =
            `Available: ${fmtNum(avail)} · Unit cost: ${fmtMoney(uc)}` +
            (qty > avail ? ` — exceeds stock by ${fmtNum(qty - avail)}` : '');
    });
}

async function onSubmitSale(e) {
    e.preventDefault();

    const productId = els.saleProduct.value;
    const quantity = Number(els.saleQty.value);
    const price = Number(els.salePrice.value);
    const saleDate = els.saleDate.value || isoDate();

    if (!productId || quantity < 1 || price < 1) {
        toast('Fill in all sale fields', 'error');
        return;
    }

    els.saleSubmit.disabled = true;
    els.saleSubmit.textContent = 'Recording…';

    try {
        await recordSale({ productId, quantity, price, saleDate });
        toast('Sale recorded', 'success');
        closeModal('saleModal');
        await refreshTransactions();
        // stock cache must refresh too
        const stockMod = await import('./stock.js');
        await stockMod.refreshStock();
        emitChange('transactions');
    } catch (err) {
        console.error(err);
        toast(err.message || 'Failed to record sale', 'error');
    } finally {
        els.saleSubmit.disabled = false;
        els.saleSubmit.textContent = 'Record sale';
    }
}

/* ============================================================
   ATOMIC SALE — decrement stock + write sold doc in one transaction
   ============================================================ */
async function recordSale({ productId, quantity, price, saleDate }) {
    const uid = state.uid;
    const stockRef = db.collection('stock').doc(productId);
    const soldRef = db.collection('sold').doc();
    const userRef = db.collection('users').doc(uid);

    return db.runTransaction(async (tx) => {
        // ---- ALL READS FIRST ----
        const stockSnap = await tx.get(stockRef);
        if (!stockSnap.exists) throw new Error('Product no longer exists');

        const data = stockSnap.data();
        if (data.userId !== uid) throw new Error('You do not own this product');

        const available = Number(data.quantity) || 0;
        if (quantity > available) {
            throw new Error(`Only ${available} unit${available === 1 ? '' : 's'} left in stock`);
        }

        const unitCost = Number(data.unitCost) ||
            (Number(data.quantity) > 0 ? Number(data.cost) / Number(data.quantity) : 0);

        const totalAmount = quantity * price;
        const costBasis = unitCost * quantity;
        const newQty = available - quantity;

        // ---- WRITES ----
        tx.update(stockRef, {
            quantity: newQty,
            soldAmount: (Number(data.soldAmount) || 0) + totalAmount,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(soldRef, {
            userId: uid,
            productId,
            productName: data.name || 'Product',
            quantity,
            price,
            totalAmount,
            unitCost,
            costBasis,
            saleDate,
            recordedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(userRef, {
            totalSales: firebase.firestore.FieldValue.increment(totalAmount),
            lastSale: firebase.firestore.FieldValue.serverTimestamp(),
        });

        return { newQty, totalAmount };
    });
}

/* ============================================================
   LOANS
   ============================================================ */
function renderLoans() {
    if (!els) return;

    const filtered = loans.filter(l =>
        currentLoanFilter === 'all' ? true :
            currentLoanFilter === 'paid' ? l.status === 'paid' :
                l.status !== 'paid'
    );

    if (!filtered.length) {
        els.loanList.innerHTML = `<div class="empty-state"><i class="fas fa-hand-holding-dollar"></i><p>No ${currentLoanFilter === 'all' ? '' : currentLoanFilter + ' '}loans.</p></div>`;
        return;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    els.loanList.innerHTML = filtered.map(l => {
        const due = parseDateValue(l.dueDate);
        const paid = l.status === 'paid';
        const amount = Number(l.amount) || 0;

        let statusPill = '';
        if (paid) {
            statusPill = '<span class="pill pill-ok">Paid</span>';
        } else if (due) {
            const diff = Math.round((due - today) / 86400000);
            if (diff < 0) statusPill = `<span class="pill pill-danger">${Math.abs(diff)}d overdue</span>`;
            else if (diff === 0) statusPill = '<span class="pill pill-warn">Due today</span>';
            else if (diff <= 3) statusPill = `<span class="pill pill-warn">${diff}d left</span>`;
        }

        return `
      <article class="row-card" data-id="${escapeHtml(l.id)}">
        <div class="rc-icon ${paid ? 'success' : 'warning'}">
          <i class="fas fa-hand-holding-dollar"></i>
        </div>
        <div class="rc-body">
          <div class="rc-top">
            <h4>${escapeHtml(l.borrowerName || 'Borrower')}</h4>
            <span class="rc-amount">${fmtMoney(amount)}</span>
          </div>
          <div class="rc-meta">
            <span>${escapeHtml(l.product || '')}</span>
            ${due ? `<span>·</span><span>Due ${fmtDate(due, { month: 'short', day: 'numeric' })}</span>` : ''}
            ${statusPill ? `<span>·</span>${statusPill}` : ''}
          </div>
        </div>
        <div class="rc-actions">
          ${!paid ? `<button class="icon-btn" data-act="pay" title="Mark paid"><i class="fas fa-check"></i></button>` : ''}
          <button class="icon-btn" data-act="edit" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger" data-act="del" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </article>`;
    }).join('');
}

function openLoanForm(loan = null) {
    els.loanForm.reset();
    if (loan) {
        els.loanModalTitle.textContent = 'Edit loan';
        els.loanId.value = loan.id;
        els.loanName.value = loan.borrowerName || '';
        els.loanProduct.value = loan.product || '';
        els.loanAmount.value = loan.amount ?? '';
        els.loanDate.value = toInputDate(loan.loanDate);
        els.loanDue.value = toInputDate(loan.dueDate);
    } else {
        els.loanModalTitle.textContent = 'Add loan';
        els.loanId.value = '';
        els.loanDate.value = isoDate();
    }
    openModal('loanModal');
}

function toInputDate(v) {
    const d = parseDateValue(v);
    return d ? isoDate(d) : '';
}

async function onSubmitLoan(e) {
    e.preventDefault();
    const id = els.loanId.value;

    const payload = {
        userId: state.uid,
        borrowerName: els.loanName.value.trim(),
        product: els.loanProduct.value.trim(),
        amount: Number(els.loanAmount.value) || 0,
        loanDate: els.loanDate.value || isoDate(),
        dueDate: els.loanDue.value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
        if (id) {
            await db.collection('loans').doc(id).update(payload);
            toast('Loan updated', 'success');
        } else {
            payload.status = 'pending';
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('loans').add(payload);
            toast('Loan added', 'success');
        }
        closeModal('loanModal');
        await refreshTransactions();
        emitChange('transactions');
    } catch (err) {
        console.error(err);
        toast('Failed to save loan', 'error');
    }
}

async function onLoanAction(e) {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.row-card');
    if (!btn || !card) return;
    const id = card.dataset.id;
    const loan = loans.find(l => l.id === id);
    if (!loan) return;

    if (btn.dataset.act === 'edit') return openLoanForm(loan);

    if (btn.dataset.act === 'pay') {
        try {
            await db.collection('loans').doc(id).update({
                status: 'paid',
                paidAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            toast('Loan marked as paid', 'success');
            await refreshTransactions();
            emitChange('transactions');
        } catch (err) {
            toast('Failed to update loan', 'error');
        }
        return;
    }

    if (btn.dataset.act === 'del') {
        const ok = await confirmDialog({
            title: 'Delete loan?',
            message: `Loan for "${loan.borrowerName}" will be removed.`,
            confirmText: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await db.collection('loans').doc(id).delete();
            toast('Loan deleted', 'success');
            await refreshTransactions();
            emitChange('transactions');
        } catch (err) {
            toast('Failed to delete loan', 'error');
        }
    }
}

/* ============================================================
   SUPPLIERS
   ============================================================ */
function renderSuppliers() {
    if (!els) return;
    const q = els.supplierSearch.value.trim().toLowerCase();
    const list = q
        ? suppliers.filter(s =>
            (s.name || '').toLowerCase().includes(q) ||
            (s.phone || '').includes(q) ||
            (s.products || '').toLowerCase().includes(q) ||
            (s.tin || '').toLowerCase().includes(q))
        : suppliers;

    if (!list.length) {
        els.supplierList.innerHTML = `<div class="empty-state"><i class="fas fa-truck"></i><p>${suppliers.length ? 'No matching suppliers.' : 'No suppliers yet.'}</p></div>`;
        return;
    }

    els.supplierList.innerHTML = list.map(s => `
    <article class="row-card" data-id="${escapeHtml(s.id)}">
      <div class="rc-icon info"><i class="fas fa-truck"></i></div>
      <div class="rc-body">
        <div class="rc-top">
          <h4>${escapeHtml(s.name || 'Supplier')}</h4>
          ${s.tin ? `<span class="pill pill-info">TIN ${escapeHtml(s.tin)}</span>` : ''}
        </div>
        <div class="rc-meta">
          <span><i class="fas fa-phone"></i> ${escapeHtml(s.phone || '—')}</span>
          <span>·</span>
          <span>${escapeHtml(s.products || '')}</span>
        </div>
      </div>
      <div class="rc-actions">
        <a class="icon-btn" href="tel:${escapeHtml(s.phone || '')}" title="Call"><i class="fas fa-phone"></i></a>
        <button class="icon-btn" data-act="edit" title="Edit"><i class="fas fa-pen"></i></button>
        <button class="icon-btn danger" data-act="del" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </article>`).join('');
}

function openSupplierForm(s = null) {
    els.supplierForm.reset();
    if (s) {
        els.supplierModalTitle.textContent = 'Edit supplier';
        els.supplierId.value = s.id;
        els.supplierName.value = s.name || '';
        els.supplierPhone.value = s.phone || '';
        els.supplierTin.value = s.tin || '';
        els.supplierProducts.value = s.products || '';
    } else {
        els.supplierModalTitle.textContent = 'Add supplier';
        els.supplierId.value = '';
    }
    openModal('supplierModal');
}

async function onSubmitSupplier(e) {
    e.preventDefault();
    const id = els.supplierId.value;

    const payload = {
        userId: state.uid,
        name: els.supplierName.value.trim(),
        phone: els.supplierPhone.value.trim(),
        products: els.supplierProducts.value.trim(),
        tin: els.supplierTin.value.trim() || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
        if (id) {
            await db.collection('suppliers').doc(id).update(payload);
            toast('Supplier updated', 'success');
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('suppliers').add(payload);
            toast('Supplier added', 'success');
        }
        closeModal('supplierModal');
        await refreshTransactions();
        emitChange('transactions');
    } catch (err) {
        console.error(err);
        toast('Failed to save supplier', 'error');
    }
}

async function onSupplierAction(e) {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.row-card');
    if (!btn || !card) return;
    const id = card.dataset.id;
    const s = suppliers.find(x => x.id === id);
    if (!s) return;

    if (btn.dataset.act === 'edit') return openSupplierForm(s);

    if (btn.dataset.act === 'del') {
        const ok = await confirmDialog({
            title: 'Delete supplier?',
            message: `"${s.name}" will be removed.`,
            confirmText: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await db.collection('suppliers').doc(id).delete();
            toast('Supplier deleted', 'success');
            await refreshTransactions();
            emitChange('transactions');
        } catch (err) {
            toast('Failed to delete supplier', 'error');
        }
    }
}