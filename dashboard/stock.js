import {
    db, state, toast, escapeHtml, fmtMoney, fmtNum,
    confirmDialog, openModal, closeModal, debounce, emitChange,
} from './shared.js';

let products = [];
let fetched = false;
let els = null;
let viewingId = null;

const $ = (s, r = document) => r.querySelector(s);

export async function initStock() {
    els = {
        search: $('#stockSearch'),
        list: $('#stockList'),
        addBtn: $('#addProductBtn'),
        statProducts: $('#statProducts'),
        statUnits: $('#statUnits'),
        statValue: $('#statValue'),

        form: $('#productForm'),
        modalTitle: $('#productModalTitle'),
        id: $('#productId'),
        name: $('#productName'),
        cost: $('#productCost'),
        qty: $('#productQuantity'),
        weight: $('#productWeight'),
        sellBy: $('#productSellBy'),
        unitHint: $('#productUnitHint'),

        viewModal: $('#productViewModal'),
        viewTitle: $('#productViewTitle'),
        viewBody: $('#productViewBody'),
        viewEdit: $('#productViewEdit'),
        viewDelete: $('#productViewDelete'),
    };

    els.addBtn.addEventListener('click', () => openForm());
    els.form.addEventListener('submit', onSubmit);
    els.search.addEventListener('input', debounce(render, 180));

    const onNum = () => updateUnitHint();
    els.cost.addEventListener('input', onNum);
    els.qty.addEventListener('input', onNum);

    els.list.addEventListener('click', (e) => {
        const card = e.target.closest('.product-card');
        if (card) openView(card.dataset.id);
    });

    els.viewEdit.addEventListener('click', () => {
        const p = products.find(x => x.id === viewingId);
        if (p) { closeModal('productViewModal'); openForm(p); }
    });

    els.viewDelete.addEventListener('click', async () => {
        const p = products.find(x => x.id === viewingId);
        if (!p) return;
        const ok = await confirmDialog({
            title: 'Delete product?',
            message: `"${p.name}" will be removed from stock. This cannot be undone.`,
            confirmText: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await db.collection('stock').doc(p.id).delete();
            toast('Product deleted', 'success');
            closeModal('productViewModal');
            await refreshStock();
            emitChange('stock');
        } catch (err) {
            console.error(err);
            toast('Failed to delete product', 'error');
        }
    });

    await refreshStock();
}

export async function refreshStock() {
    const snap = await db.collection('stock').where('userId', '==', state.uid).get();
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    fetched = true;
    render();
}

export async function ensureStock() {
    if (!fetched) await refreshStock();
    return products;
}

export function getStock() { return products; }

/* ---------- render ---------- */
function render() {
    if (!els) return;

    const totalUnits = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const totalValue = products.reduce(
        (s, p) => s + (Number(p.quantity) || 0) * unitCostOf(p), 0
    );

    els.statProducts.textContent = fmtNum(products.length);
    els.statUnits.textContent = fmtNum(totalUnits);
    els.statValue.textContent = fmtMoney(totalValue);

    const q = els.search.value.trim().toLowerCase();
    const list = q
        ? products.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            String(p.cost || '').includes(q))
        : products;

    if (!list.length) {
        els.list.innerHTML = products.length
            ? `<div class="empty-state"><i class="fas fa-magnifying-glass"></i><p>No products match "${escapeHtml(els.search.value)}".</p></div>`
            : `<div class="empty-state"><i class="fas fa-box-open"></i><p>No products yet. Add your first product to start tracking stock.</p></div>`;
        return;
    }

    els.list.innerHTML = list.map(p => {
        const qty = Number(p.quantity) || 0;
        const uc = unitCostOf(p);
        const pill = qty === 0
            ? '<span class="pill pill-danger">Out</span>'
            : qty < 5
                ? '<span class="pill pill-warn">Low</span>'
                : '';
        return `
      <article class="product-card" data-id="${escapeHtml(p.id)}">
        <div class="pc-icon"><i class="fas fa-box"></i></div>
        <div class="pc-body">
          <div class="pc-top">
            <h4 class="pc-name">${escapeHtml(p.name || 'Untitled')}</h4>
            ${pill}
          </div>
          <div class="pc-meta">
            <span><b>${fmtNum(qty)}</b> units</span>
            <span>Unit cost <b>${fmtMoney(uc)}</b></span>
            <span>Sold <b>${fmtMoney(p.soldAmount)}</b></span>
          </div>
        </div>
        <span class="icon-btn" aria-hidden="true"><i class="fas fa-chevron-right"></i></span>
      </article>`;
    }).join('');
}

function unitCostOf(p) {
    const n = Number(p.unitCost);
    if (!isNaN(n) && n > 0) return n;
    const c = Number(p.cost) || 0;
    const q = Number(p.quantity) || 0;
    return q > 0 ? c / q : 0;
}

/* ---------- form ---------- */
function updateUnitHint() {
    const c = Number(els.cost.value) || 0;
    const q = Number(els.qty.value) || 0;
    els.unitHint.textContent = q > 0 ? `Unit cost: ${fmtMoney(c / q)}` : '';
}

function openForm(p = null) {
    els.form.reset();
    els.unitHint.textContent = '';
    if (p) {
        els.modalTitle.textContent = 'Edit product';
        els.id.value = p.id;
        els.name.value = p.name || '';
        els.cost.value = p.cost ?? '';
        els.qty.value = p.quantity ?? '';
        els.weight.value = p.weight ?? '';
        els.sellBy.value = p.estimatedSellDate || '';
        updateUnitHint();
    } else {
        els.modalTitle.textContent = 'Add product';
        els.id.value = '';
    }
    openModal('productModal');
}

async function onSubmit(e) {
    e.preventDefault();

    const id = els.id.value;
    const name = els.name.value.trim();
    const cost = Number(els.cost.value) || 0;
    const quantity = Number(els.qty.value) || 0;
    const weight = els.weight.value ? Number(els.weight.value) : null;
    const sellBy = els.sellBy.value || null;
    const unitCost = quantity > 0 ? cost / quantity : 0;

    const payload = {
        userId: state.uid,
        name,
        cost,
        quantity,
        unitCost,
        weight,
        estimatedSellDate: sellBy,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
        if (id) {
            await db.collection('stock').doc(id).update(payload);
            toast('Product updated', 'success');
        } else {
            payload.soldAmount = 0;
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('stock').add(payload);
            toast('Product added', 'success');
        }
        closeModal('productModal');
        await refreshStock();
        emitChange('stock');
    } catch (err) {
        console.error(err);
        toast('Failed to save product', 'error');
    }
}

/* ---------- view ---------- */
function openView(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    viewingId = id;

    const qty = Number(p.quantity) || 0;
    const uc = unitCostOf(p);
    const stockValue = qty * uc;

    els.viewTitle.textContent = p.name || 'Product';
    els.viewBody.innerHTML = `
    <div class="view-grid">
      <div class="view-item"><label>Remaining</label><div>${fmtNum(qty)} units</div></div>
      <div class="view-item"><label>Unit cost</label><div>${fmtMoney(uc)}</div></div>
      <div class="view-item"><label>Total cost</label><div>${fmtMoney(p.cost)}</div></div>
      <div class="view-item"><label>Stock value</label><div>${fmtMoney(stockValue)}</div></div>
      <div class="view-item"><label>Sold amount</label><div>${fmtMoney(p.soldAmount)}</div></div>
      <div class="view-item"><label>Weight</label><div>${p.weight ? fmtNum(p.weight) + ' KG' : '—'}</div></div>
      <div class="view-item"><label>Sell-by date</label><div>${p.estimatedSellDate || '—'}</div></div>
      <div class="view-item"><label>Added</label><div>${p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '—'}</div></div>
    </div>`;

    openModal('productViewModal');
}