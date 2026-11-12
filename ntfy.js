/* ============================================================
   ntfy.js — free web push via https://ntfy.sh
   Each user gets a deterministic topic derived from their uid.
   Send by POSTing to ntfy.sh/<topic>.
   User can subscribe on their phone with the ntfy app to receive
   pushes even when the browser tab is closed.
   ============================================================ */
(function () {
    'use strict';

    var NTFY_BASE = 'https://ntfy.sh';

    function topicFor(uid) {
        if (!uid) return null;
        var h = 0;
        for (var i = 0; i < uid.length; i++) {
            h = ((h << 5) - h + uid.charCodeAt(i)) | 0;
        }
        return 'genzura-' + Math.abs(h).toString(36).padStart(7, '0');
    }

    async function push(opts) {
        var uid = window.__genzuraUid;
        var topic = topicFor(uid);
        if (!topic) { console.warn('[ntfy] no uid set'); return false; }

        try {
            var res = await fetch(NTFY_BASE + '/' + topic, {
                method: 'POST',
                headers: {
                    'Title': opts.title || 'Genzura',
                    'Priority': String(opts.priority || 3),
                    'Tags': (opts.tags || ['bell']).join(','),
                    'Content-Type': 'text/plain'
                },
                body: opts.body || ''
            });
            return res.ok;
        } catch (e) {
            console.warn('[ntfy] push failed', e);
            return false;
        }
    }

    async function requestPermission() {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        try {
            var p = await Notification.requestPermission();
            return p === 'granted';
        } catch (e) { return false; }
    }

    function notifyLocal(opts) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            var n = new Notification(opts.title || 'Genzura', {
                body: opts.body || '',
                tag: opts.tag || 'genzura',
                icon: 'https://i.ibb.co/mFqfcpPj/cropped-circle-image.png',
                badge: 'https://i.ibb.co/mFqfcpPj/cropped-circle-image.png',
                requireInteraction: !!opts.requireInteraction
            });
            n.onclick = function () { window.focus(); n.close(); };
            if (!opts.requireInteraction) setTimeout(function () { n.close(); }, 10000);
        } catch (e) { console.warn('[notify] failed', e); }
    }

    function setUid(uid) { window.__genzuraUid = uid; }

    window.Ntfy = {
        topicFor: topicFor,
        push: push,
        requestPermission: requestPermission,
        notifyLocal: notifyLocal,
        setUid: setUid
    };
})();