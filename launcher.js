
// launcher.js - Main Menu / Launcher Logic

document.addEventListener('DOMContentLoaded', () => {
    // Shared Auth Init
    const auth = new AuthManager({
        updateSyncIndicator: (success) => {
            const el = document.getElementById('syncStatus');
            const dot = el?.querySelector('.sync-dot');
            const text = document.getElementById('syncText');
            if (!el || !dot || !text) return;

            dot.className = success ? 'sync-dot' : 'sync-dot offline';
            text.textContent = success ? 'Synchronisiert' : 'Sync Fehler';
            el.classList.add('visible');
            setTimeout(() => el.classList.remove('visible'), 3000);
        }
    });

    // Auth UI logic
    const els = {
        openBtn: document.getElementById('openAccountBtn'),
        authMenu: document.getElementById('authMenu'),
        profileMenu: document.getElementById('profileMenu'),
        closeAuth: document.getElementById('closeAuthBtn'),
        closeProfile: document.getElementById('closeProfileBtn'),
        authForm: document.getElementById('authForm'),
        tabLogin: document.getElementById('showLoginTab'),
        tabRegister: document.getElementById('showRegisterTab'),
        logoutBtn: document.getElementById('logoutBtn'),
        historyList: document.getElementById('historyList'),
        usernameDisplay: document.getElementById('profileUsername'),
        emailDisplay: document.getElementById('profileEmail'),
        simCount: document.getElementById('pSimCount'),
        bestGrade: document.getElementById('pBestGrade'),
        namePreview: document.querySelector('.user-name-preview'),
        googleBtn: document.getElementById('googleAuthBtn'),
        openAchBtn: document.getElementById('openAchievementsBtn'),
        achMenu: document.getElementById('achievementsMenu'),
        achList: document.getElementById('achievementsList'),
        closeAch: document.getElementById('closeAchievementsBtn'),
        closeAchBottom: document.getElementById('closeAchievementsBtnBottom'),
        achCountPreview: document.querySelector('.achievement-count-preview'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn'),
        openSettingsBtn: document.getElementById('openSettingsBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        settingsMenu: document.getElementById('settingsMenu'),
        avatarInput: document.getElementById('avatarInput'),
        profileAvatar: document.getElementById('profileAvatar'),
        topNavAvatar: document.getElementById('topNavAvatar'),
        removeAvatarBtn: document.getElementById('removeAvatarBtn'),
        openAccSettingsBtn: document.getElementById('openAccSettingsBtn'),
        accSettingsMenu: document.getElementById('accSettingsMenu'),
        closeAccSettingsBtn: document.getElementById('closeAccSettingsBtn'),
        saveAccSettingsBtn: document.getElementById('saveAccSettingsBtn'),
        setNewUsername: document.getElementById('setNewUsername'),
        setNewPassword: document.getElementById('setNewPassword')
    };

    let authMode = 'login';

    function updateAuthUI() {
        const setAvatar = (el, src) => {
            if (!el) return;
            if (src) el.innerHTML = `<img src="${src}" alt="Avatar">`;
            else el.innerHTML = '👤';
        };

        if (auth.currentUser) {
            const displayName = auth.currentUser.username || auth.currentUser.email.split('@')[0];
            if (els.namePreview) els.namePreview.textContent = displayName;
            if (els.usernameDisplay) els.usernameDisplay.textContent = displayName;

            if (els.achCountPreview) {
                const earned = (auth.currentUser.achievements || []).length;
                els.achCountPreview.textContent = `${earned}/${auth.achievements.length}`;
            }
            setAvatar(els.topNavAvatar, auth.currentUser.avatar);
            setAvatar(els.profileAvatar, auth.currentUser.avatar);
            if (els.removeAvatarBtn) els.removeAvatarBtn.style.display = auth.currentUser.avatar ? 'flex' : 'none';
        } else {
            if (els.namePreview) els.namePreview.textContent = "Nicht angemeldet";
            if (els.achCountPreview) els.achCountPreview.textContent = "--";
            setAvatar(els.topNavAvatar, null);
            setAvatar(els.profileAvatar, null);
            if (els.removeAvatarBtn) els.removeAvatarBtn.style.display = 'none';
        }
    }

    function switchAuthMode(mode) {
        authMode = mode;
        const title = document.getElementById('authTitle');
        if (title) title.textContent = mode === 'login' ? 'Anmelden' : 'Registrieren';
        els.tabLogin?.classList.toggle('active', mode === 'login');
        els.tabRegister?.classList.toggle('active', mode === 'register');
        const submit = document.getElementById('authSubmitBtn');
        if (submit) submit.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
    }

    function renderHistory() {
        if (!els.historyList) return;
        els.historyList.innerHTML = '';
        if (!auth.currentUser || !auth.currentUser.history || auth.currentUser.history.length === 0) {
            els.historyList.innerHTML = '<p class="empty-msg">Noch keine Auswertungen vorhanden.</p>';
            return;
        }

        const indexedHistory = auth.currentUser.history.map((item, index) => ({ item, index }));

        [...indexedHistory].reverse().forEach((entry) => {
            const item = entry.item;
            const idx = entry.index;
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="h-main">
                    <span class="h-date">${item.date}</span>
                    <div class="h-row">
                        <span class="h-grade grade-${item.grade.toLowerCase()}">${item.grade}</span>
                        <span class="h-score">${item.tir}% TiR</span>
                    </div>
                </div>
                <button class="h-delete-btn" data-index="${idx}" title="Löschen">🗑️</button>
            `;

            div.querySelector('.h-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm("Möchtest du dieses Ergebnis wirklich löschen?")) {
                    await auth.deleteResult(idx);
                    renderHistory();
                    updateAuthUI();
                }
            });

            els.historyList.appendChild(div);
        });
    }

    // ... (renderAchievements unchanged) ...

    els.openBtn?.addEventListener('click', () => {
        if (auth.currentUser) {
            els.usernameDisplay.textContent = auth.currentUser.username || auth.currentUser.email.split('@')[0];
            els.emailDisplay.textContent = auth.currentUser.email;
            els.simCount.textContent = (auth.currentUser.history || []).length;
            const grades = (auth.currentUser.history || []).map(h => h.grade);
            els.bestGrade.textContent = grades.includes('A') ? 'A' : (grades.includes('B') ? 'B' : (grades.length ? grades[0] : '--'));
            renderHistory();
            els.profileMenu.classList.remove('hidden');
        } else {
            els.authMenu.classList.remove('hidden');
        }
    });

    els.closeAuth?.addEventListener('click', () => els.authMenu.classList.add('hidden'));
    els.closeProfile?.addEventListener('click', () => els.profileMenu.classList.add('hidden'));
    els.tabLogin?.addEventListener('click', () => switchAuthMode('login'));
    els.tabRegister?.addEventListener('click', () => switchAuthMode('register'));

    els.authForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('authEmail').value;
        const pass = document.getElementById('authPassword').value;
        const btn = document.getElementById('authSubmitBtn');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Verarbeite...";

        try {
            if (authMode === 'register') {
                await auth.register(email, pass);
                alert("Konto erstellt! Bitte anmelden.");
                switchAuthMode('login');
            } else {
                const user = await auth.login(email, pass);
                if (user) {
                    await auth.unlockAchievement('persistent');
                    updateAuthUI();
                    updateStoryLocking();
                    els.authMenu.classList.add('hidden');
                } else alert("Falsche Daten.");
            }
        } catch (err) {
            alert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });

    els.logoutBtn?.addEventListener('click', () => {
        auth.currentUser = null;
        localStorage.removeItem('sim_current_user');
        updateAuthUI();
        els.profileMenu.classList.add('hidden');
    });

    // ... (Achs and Settings event listeners unchanged) ...

    // Profile Management
    els.avatarInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !auth.currentUser) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            auth.currentUser.avatar = event.target.result;
            await auth.saveCurrentUserChange();
            updateAuthUI();
        };
        reader.readAsDataURL(file);
    });

    els.removeAvatarBtn?.addEventListener('click', async () => {
        if (confirm("Profilbild wirklich entfernen?")) {
            await auth.removeAvatar();
            updateAuthUI();
        }
    });

    // Account Settings
    els.openAccSettingsBtn?.addEventListener('click', () => {
        if (!auth.currentUser) return;
        els.setNewUsername.value = auth.currentUser.username || auth.currentUser.email.split('@')[0];
        els.setNewPassword.value = '';
        els.accSettingsMenu.classList.remove('hidden');
    });

    els.closeAccSettingsBtn?.addEventListener('click', () => els.accSettingsMenu.classList.add('hidden'));

    els.saveAccSettingsBtn?.addEventListener('click', async () => {
        const nextName = els.setNewUsername.value.trim();
        const nextPass = els.setNewPassword.value;

        if (nextName) await auth.updateUsername(nextName);
        if (nextPass) await auth.updatePassword(nextPass);

        await auth.saveCurrentUserChange();
        updateAuthUI();
        els.accSettingsMenu.classList.add('hidden');
        alert("Einstellungen gespeichert & synchronisiert!");
    });

    // --- Mode Selection Logic ---
    const startGameBtn = document.getElementById('startGameBtn');
    const modeSelection = document.getElementById('modeSelection');
    const backToMainFromMode = document.getElementById('backToMainFromMode');
    const startArcade = document.getElementById('startArcade');
    const startStory = document.getElementById('startStory');
    const storySelection = document.getElementById('storySelection');
    const backToModeFromStory = document.getElementById('backToModeFromStory');

    startGameBtn?.addEventListener('click', () => {
        document.getElementById('mainMenuCard').classList.add('hidden');
        modeSelection.classList.remove('hidden');
    });

    backToMainFromMode?.addEventListener('click', () => {
        modeSelection.classList.add('hidden');
        document.getElementById('mainMenuCard').classList.remove('hidden');
    });

    startArcade?.addEventListener('click', () => { window.location.href = 'arcade.html'; });

    startStory?.addEventListener('click', () => {
        modeSelection.classList.add('hidden');
        storySelection.classList.remove('hidden');
    });

    backToModeFromStory?.addEventListener('click', () => {
        storySelection.classList.add('hidden');
        modeSelection.classList.remove('hidden');
    });

    function updateStoryLocking() {
        const earned = auth.currentUser ? (auth.currentUser.achievements || []) : [];
        document.querySelectorAll('.story-lvl-btn').forEach(btn => {
            const lvl = parseInt(btn.dataset.level);
            if (lvl === 1) return; // Level 1 is always open

            const prevLvlAch = `story_lvl${lvl - 1}`;
            const isLocked = !earned.includes(prevLvlAch);

            btn.disabled = isLocked;
            btn.style.opacity = isLocked ? '0.5' : '1';
            btn.style.cursor = isLocked ? 'not-allowed' : 'pointer';

            if (isLocked) {
                btn.title = "Schließe das vorherige Level ab, um dieses freizuschalten.";
            } else {
                btn.title = "";
            }
        });
    }

    document.querySelectorAll('.story-lvl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) {
                // The game logic handles startStoryLevel natively in script.js now.
                // Redirect removed.
            }
        });
    });

    // Theme logic
    const themeBtn = document.getElementById('themeToggle');
    if (localStorage.getItem('sim_theme') === 'dark') {
        document.body.classList.add('dark-mode');
        document.documentElement.classList.add('dark-mode');
    }
    themeBtn?.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-mode');
        document.documentElement.classList.toggle('dark-mode', isDark);
        localStorage.setItem('sim_theme', isDark ? 'dark' : 'light');
    });

    // Initial UI Setup
    updateAuthUI();
    updateStoryLocking();
});
