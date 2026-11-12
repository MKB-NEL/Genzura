/* ============================================================
   locker.js — GENZURA access gate
   ============================================================ */
(function (global) {
    'use strict';

    // FREE_ACCESS allows everyone in if you ever need to pause the paywall.
    // Set to false to enforce premium checks.
    var FREE_ACCESS = false;
    var HOME_URL = 'home.html';
    var LOGIN_URL = 'index.html';
    var CACHE_TTL = 60 * 1000; // 1 minute cache

    var _result = null;
    var _at = 0;

    function auth() { return global.firebase.auth(); }
    function db() { return global.firebase.firestore(); }

    function waitForUser() {
        return new Promise(function (resolve) {
            var a = auth();
            var unsub = a.onAuthStateChanged(function (user) {
                if (typeof unsub === 'function') unsub();
                resolve(user || null);
            });
        });
    }

    function isPremium(profile) {
        if (!profile) return false;
        // Admins always bypass the paywall
        if (profile.role === 'admin') return true;

        // Check premiumUntil timestamp
        if (!profile.premiumUntil) return false;

        var ms =
            typeof profile.premiumUntil.toMillis === 'function' ? profile.premiumUntil.toMillis() :
                typeof profile.premiumUntil.seconds === 'number' ? profile.premiumUntil.seconds * 1000 :
                    new Date(profile.premiumUntil).getTime();

        return ms > Date.now();
    }

    function check(force) {
        if (!force && _result && (Date.now() - _at) < CACHE_TTL) {
            return Promise.resolve(_result);
        }

        return waitForUser().then(function (user) {
            if (!user) {
                _result = { unlocked: false, reason: 'no-user', user: null, profile: null };
                _at = Date.now();
                return _result;
            }

            return db().collection('users').doc(user.uid).get()
                .then(function (snap) {
                    var profile = snap.exists ? snap.data() : null;

                    if (FREE_ACCESS || isPremium(profile)) {
                        _result = { unlocked: true, reason: 'premium', user: user, profile: profile };
                    } else {
                        _result = { unlocked: false, reason: 'no-premium', user: user, profile: profile };
                    }
                    _at = Date.now();
                    return _result;
                })
                .catch(function (err) {
                    console.error('[LOCKER] profile read failed', err);
                    // Fail-safe: lock them out if we can't read the profile
                    _result = { unlocked: false, reason: 'profile-error', user: user, profile: null };
                    _at = Date.now();
                    return _result;
                });
        });
    }

    function guard(opts) {
        opts = opts || {};
        var redirectIfLocked = opts.redirectIfLocked !== false;
        var force = !!opts.force;

        return check(force).then(function (res) {
            if (res.unlocked || !redirectIfLocked) return res;

            if (res.reason === 'no-user') {
                location.replace(LOGIN_URL);
            } else {
                location.replace(HOME_URL);
            }
            return res;
        }).catch(function (err) {
            console.error('[LOCKER] guard error', err);
            return { unlocked: false, reason: 'guard-error', user: null, profile: null };
        });
    }

    global.Locker = {
        check: check,
        guard: guard,
        currentUser: function () { return _result ? _result.user : null; },
        currentProfile: function () { return _result ? _result.profile : null; },
        current: function () { return _result; },
        isPremium: isPremium,
        FREE_ACCESS: FREE_ACCESS,
        HOME_URL: HOME_URL,
        LOGIN_URL: LOGIN_URL
    };
})(window);