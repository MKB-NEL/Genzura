// ============================================================
// GENZURA · Home panel
// ============================================================

import { db, auth, state } from './shared.js';

let els = null;
let initialized = false;

export async function initHome() {
    if (initialized) return;

    // Safely grab all elements
    els = {
        userName: document.getElementById('userName'),
        businessName: document.getElementById('businessName'),
        itemsCount: document.getElementById('itemsCount'),
        signOutBtn: document.getElementById('signOut'),
        adContent: document.getElementById('adContent'),
        introVideo: document.getElementById('introVideo'),
        supportModal: document.getElementById('supportModal'),
    };

    loadUserData();
    wireEvents();

    initialized = true;
}

export async function refreshHome() {
    if (initialized) loadUserData();
}

/* ---------- User Data ---------- */
function loadUserData() {
    const userId = state.uid;
    if (!userId) return;

    db.collection('users').doc(userId).get()
        .then((doc) => {
            if (doc.exists) {
                const userData = doc.data();

                // Optional chaining (?.) guarantees it won't crash if an element is missing
                if (els.userName) els.userName.textContent = userData.fullName || 'User';
                if (els.businessName) els.businessName.textContent = userData.businessName || 'Business';

                if (els.itemsCount && userData.itemsCount !== undefined) {
                    els.itemsCount.textContent = userData.itemsCount;
                }
            } else {
                fallbackLocal();
            }
        })
        .catch((error) => {
            console.log('Error getting user data:', error);
            fallbackLocal();
        });
}

function fallbackLocal() {
    try {
        const localUserData = JSON.parse(localStorage.getItem('genzuraUser') || '{}');
        if (els?.userName && localUserData.name) els.userName.textContent = localUserData.name;
        if (els?.businessName && localUserData.business) els.businessName.textContent = localUserData.business;
    } catch (e) {
        // Ignore parse errors
    }
}

/* ---------- Events ---------- */
function wireEvents() {
    if (!els) return;

    // 1. Contact support modal
    els.adContent?.addEventListener('click', function () {
        els.supportModal?.classList.add('open');
    });

    // 2. Sign out button
    els.signOutBtn?.addEventListener('click', function (e) {
        e.preventDefault();

        if (els.signOutBtn) {
            els.signOutBtn.disabled = true;
            els.signOutBtn.textContent = 'Signing out…';
        }

        auth.signOut().then(() => {
            localStorage.removeItem('genzuraUser');
            window.location.replace('index.html');
        }).catch((error) => {
            console.error('Sign out error:', error);
            if (els.signOutBtn) {
                els.signOutBtn.disabled = false;
                els.signOutBtn.textContent = 'Sign out';
            }
        });
    });

    // 3. Video error fallback (if video.mp4 is missing or blocked)
    els.introVideo?.addEventListener('error', function () {
        if (this.parentElement) {
            this.parentElement.innerHTML = `
        <div style="background: #000; color: #fff; padding: 40px 20px; text-align: center; height: 100%; display: flex; flex-direction: column; justify-content: center;">
          <p style="margin-bottom: 8px;">Welcome to GENZURA Business Management</p>
          <p style="font-size: 14px; opacity: 0.8;">Your business solution platform</p>
        </div>
      `;
        }
    });
}