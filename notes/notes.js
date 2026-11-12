// ============================================================
// notes/notes.js — Notes & Reminders
// ============================================================

import {
    db, state, toast, escapeHtml, openModal, closeModal,
    confirmDialog, debounce, bus, fmtDate
} from '../dashboard/shared.js';

const $ = (s, r = document) => r.querySelector(s);

let notes = [];
let currentFilter = 'all';
let pollTimer = null;
let els = null;
let notifGranted = false;

async function boot() {
    els = {
        list: $('#notesList'),
        search: $('#notesSearch'),
        addBtn: $('#addNoteBtn'),
        filterTabs: document.querySelectorAll('#notesFilter .tab'),
        notifBtn: $('#enableNotifBtn'),
        modal: $('#noteModal'),
        form: $('#noteForm'),
        modalTitle: $('#noteModalTitle'),
        id: $('#noteId'),
        title: $('#noteTitle'),
        body: $('#noteBody'),
        reminder: $('#noteReminder'),
        priority: $('#notePriority'),
    };

    if (!els.list) return; // Safety check if DOM is missing

    wireEvents();
    await refresh();

    if (window.Ntfy) {
        notifGranted = await window.Ntfy.requestPermission();
        updateNotifBtn();
    }
    startPolling();
}

async function refresh() {
    const snap = await db.collection('notes')
        .where('userId', '==', state.uid)
        .get();

    notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    notes.sort((a, b) => {
        const ra = reminderMs(a);
        const rb = reminderMs(b);
        const aDue = ra && ra <= Date.now() && !a.notifiedAt && !a.done;
        const bDue = rb && rb <= Date.now() && !b.notifiedAt && !b.done;
        if (aDue !== bDue) return aDue ? -1 : 1;
        if (ra && rb) return ra - rb;
        if (ra) return -1;
        if (rb) return 1;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });

    render();
}

function reminderMs(n) {
    if (!n.reminderAt) return null;
    if (typeof n.reminderAt.toMillis === 'function') return n.reminderAt.toMillis();
    if (typeof n.reminderAt.seconds === 'number') return n.reminderAt.seconds * 1000;
    const d = new Date(n.reminderAt);
    return isNaN(d.getTime()) ? null : d.getTime();
}

function render() {
    if (!els) return;

    const q = (els.search.value || '').trim().toLowerCase();
    let list = notes;

    if (currentFilter === 'active') list = list.filter(n => !n.done);
    else if (currentFilter === 'done') list = list.filter(n => n.done);
    else if (currentFilter === 'reminders') list = list.filter(n => n.reminderAt && !n.done);

    if (q) {
        list = list.filter(n =>
            (n.title || '').toLowerCase().includes(q) ||
            (n.body || '').toLowerCase().includes(q)
        );
    }

    if (!list.length) {
        els.list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-note-sticky"></i>
        <p>${notes.length ? 'No notes match this view.' : 'No notes yet. Create your first note to get started.'}</p>
      </div>`;
        return;
    }

    els.list.innerHTML = list.map(n => renderCard(n)).join('');
    wireCardActions();
}

function renderCard(n) {
    const now = Date.now();
    const rMs = reminderMs(n);
    let reminderHtml = '';

    if (rMs) {
        const d = new Date(rMs);
        const when = fmtDate(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        if (n.notifiedAt) {
            reminderHtml = `<span class="reminder-badge sent"><i class="fas fa-bell"></i> Sent ${when}</span>`;
        } else if (rMs <= now) {
            reminderHtml = `<span class="reminder-badge overdue"><i class="fas fa-clock"></i> Overdue · ${when}</span>`;
        } else {
            reminderHtml = `<span class="reminder-badge upcoming"><i class="fas fa-clock"></i> ${when}</span>`;
        }
    }

    const priorityLabel = { 2: 'Low', 3: 'Normal', 4: 'High', 5: 'Urgent' }[n.priority] || 'Normal';
    const priorityClass = { 2: 'pill-info', 3: 'pill-info', 4: 'pill-warn', 5: 'pill-danger' }[n.priority] || 'pill-info';

    return `
    <article class="note-card ${n.done ? 'done' : ''}" data-id="${escapeHtml(n.id)}">
      <button class="note-check" data-act="toggle" title="${n.done ? 'Mark active' : 'Mark done'}">
        <i class="fas fa-check"></i>
      </button>
      <div class="note-body-wrap">
        <div class="note-top">
          <h4 class="note-title">${escapeHtml(n.title || 'Untitled')}</h4>
          <span class="pill ${priorityClass}">${priorityLabel}</span>
        </div>
        ${n.body ? `<div class="note-text">${escapeHtml(n.body)}</div>` : ''}
        <div class="note-meta">
          ${reminderHtml}
          <span><i class="fas fa-calendar"></i> ${n.createdAt ? fmtDate(n.createdAt.seconds ? n.createdAt.seconds * 1000 : n.createdAt, { month: 'short', day: 'numeric' }) : '—'}</span>
        </div>
      </div>
      <div class="note-actions">
        <button class="icon-btn" data-act="edit" title="Edit"><i class="fas fa-pen"></i></button>
        <button class="icon-btn danger" data-act="del" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </article>`;
}

function wireCardActions() {
    els.list.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const id = card.dataset.id;
            const n = notes.find(x => x.id === id);
            if (!n) return;

            if (btn.dataset.act === 'toggle') return toggleDone(n);
            if (btn.dataset.act === 'edit') return openEditor(n);
            if (btn.dataset.act === 'del') return deleteNote(n);
        });
    });
}

function openEditor(n = null) {
    els.form.reset();
    if (n) {
        els.modalTitle.textContent = 'Edit note';
        els.id.value = n.id;
        els.title.value = n.title || '';
        els.body.value = n.body || '';
        els.reminder.value = n.reminderAt ? toInputDateTime(reminderMs(n)) : '';
        els.priority.value = String(n.priority || 3);
    } else {
        els.modalTitle.textContent = 'New note';
        els.id.value = '';
        els.priority.value = '3';
    }
    openModal('noteModal');
}

function toInputDateTime(ms) {
    const d = new Date(ms);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function onSubmitNote(e) {
    e.preventDefault();
    const id = els.id.value;
    const title = els.title.value.trim();
    const body = els.body.value.trim();
    const reminderValue = els.reminder.value;
    const priority = Number(els.priority.value) || 3;

    const payload = {
        userId: state.uid,
        title,
        body,
        priority,
        reminderAt: reminderValue ? firebase.firestore.Timestamp.fromDate(new Date(reminderValue)) : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
        if (id) {
            await db.collection('notes').doc(id).update(payload);
            toast('Note updated', 'success');
        } else {
            payload.done = false;
            payload.notifiedAt = null;
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('notes').add(payload);
            toast('Note created', 'success');
        }
        closeModal('noteModal');
        await refresh();
        if (bus) bus.dispatchEvent(new CustomEvent('data:changed', { detail: { source: 'notes' } }));
    } catch (err) {
        console.error(err);
        toast('Failed to save note', 'error');
    }
}

async function toggleDone(n) {
    try {
        await db.collection('notes').doc(n.id).update({
            done: !n.done,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await refresh();
    } catch (err) {
        console.error(err);
        toast('Failed to update note', 'error');
    }
}

async function deleteNote(n) {
    const ok = await confirmDialog({
        title: 'Delete note?',
        message: `"${n.title}" will be removed.`,
        confirmText: 'Delete',
        danger: true,
    });
    if (!ok) return;
    try {
        await db.collection('notes').doc(n.id).delete();
        toast('Note deleted', 'success');
        await refresh();
    } catch (err) {
        console.error(err);
        toast('Failed to delete note', 'error');
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(checkDueReminders, 60 * 1000);
    setTimeout(checkDueReminders, 2000);
}

async function checkDueReminders() {
    const now = Date.now();
    const due = notes.filter(n => {
        if (n.done || n.notifiedAt) return false;
        const r = reminderMs(n);
        return r && r <= now;
    });

    if (!due.length) return;

    for (const n of due) {
        if (window.Ntfy) {
            window.Ntfy.notifyLocal({
                title: '🔔 ' + (n.title || 'Reminder'),
                body: n.body || 'Reminder from Genzura',
                tag: 'genzura-' + n.id,
            });

            window.Ntfy.push({
                title: '🔔 ' + (n.title || 'Reminder'),
                body: n.body || 'Reminder from Genzura',
                priority: n.priority || 3,
                tags: ['bell', 'genzura'],
            });
        }

        try {
            await db.collection('notes').doc(n.id).update({
                notifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {
            console.warn('[notes] could not mark notified', e);
        }
    }

    await refresh();
}

function updateNotifBtn() {
    if (!els.notifBtn) return;
    const granted = notifGranted || (window.Notification && Notification.permission === 'granted');
    els.notifBtn.style.background = granted ? 'var(--success-soft)' : '';
    els.notifBtn.style.borderColor = granted ? 'var(--success)' : '';
    els.notifBtn.style.color = granted ? 'var(--success)' : '';
}

async function requestNotifications() {
    if (!window.Ntfy) return;
    const granted = await window.Ntfy.requestPermission();
    notifGranted = granted;
    updateNotifBtn();
    if (granted) {
        toast('Notifications enabled', 'success');
        window.Ntfy.notifyLocal({
            title: 'Genzura',
            body: 'Notifications are now enabled.',
        });
    } else {
        toast('Notifications blocked', 'error');
    }
}

function wireEvents() {
    els.addBtn.addEventListener('click', () => openEditor());
    els.form.addEventListener('submit', onSubmitNote);
    els.search.addEventListener('input', debounce(render, 180));
    els.notifBtn.addEventListener('click', requestNotifications);

    els.filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            els.filterTabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            currentFilter = tab.dataset.filter;
            render();
        });
    });
}

// Run boot, then ALWAYS remove loading screen regardless of error
boot().catch((err) => {
    console.error('[notes] boot failed', err);
}).finally(() => {
    const bootEl = document.getElementById('boot');
    if (bootEl) bootEl.remove();
    document.body.classList.remove('is-loading');
});