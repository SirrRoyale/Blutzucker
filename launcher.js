
// launcher.js - Main Menu / Launcher Logic

document.addEventListener('DOMContentLoaded', () => {
    // Shared Auth Init
    const auth = new AuthManager(null); // No simulation context needed for launcher

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
        settingsMenu: document.getElementById('settingsMenu')
    };

    let authMode = 'login';

    function updateAuthUI() {
        if (auth.currentUser) {
            if (els.namePreview) els.namePreview.textContent = auth.currentUser.email.split('@')[0];
            if (els.achCountPreview) {
                const earned = (auth.currentUser.achievements || []).length;
                els.achCountPreview.textContent = `${earned}/${auth.achievements.length}`;
            }
        } else {
            if (els.namePreview) els.namePreview.textContent = "Nicht angemeldet";
            if (els.achCountPreview) els.achCountPreview.textContent = "--";
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

        // We render it reversed, but we need the original index for deletion
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

            div.querySelector('.h-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm("Möchtest du dieses Ergebnis wirklich löschen?")) {
                    auth.deleteResult(idx);
                    renderHistory();
                    // Update stats preview if needed
                    updateAuthUI();
                }
            });

            els.historyList.appendChild(div);
        });
    }

    function renderAchievements() {
        if (!els.achList) return;
        els.achList.innerHTML = '';
        const earned = auth.currentUser ? (auth.currentUser.achievements || []) : [];

        // Group by category
        const categories = {};
        auth.achievements.forEach(ach => {
            if (!categories[ach.category]) categories[ach.category] = [];
            categories[ach.category].push(ach);
        });

        for (const [catName, achs] of Object.entries(categories)) {
            const catHeader = document.createElement('h3');
            catHeader.className = 'achievement-category-title';
            catHeader.textContent = catName;
            els.achList.appendChild(catHeader);

            achs.forEach(ach => {
                const isEarned = earned.includes(ach.id);
                const div = document.createElement('div');
                div.className = `achievement-item ${isEarned ? '' : 'locked'} ${ach.id === 'platinum' ? 'platinum' : ''}`;
                div.innerHTML = `
                    <div class="achievement-icon">${ach.icon}</div>
                    <div class="achievement-info">
                        <h4>${ach.title}</h4>
                        <p>${ach.desc}</p>
                    </div>
                    <div class="achievement-status">${isEarned ? '✅' : '🔒'}</div>
                `;
                els.achList.appendChild(div);
            });
        }
    }

    els.openBtn?.addEventListener('click', () => {
        if (auth.currentUser) {
            els.usernameDisplay.textContent = auth.currentUser.email.split('@')[0];
            els.emailDisplay.textContent = auth.currentUser.email;
            els.simCount.textContent = auth.currentUser.history.length;
            const grades = auth.currentUser.history.map(h => h.grade);
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

    els.authForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('authEmail').value;
        const pass = document.getElementById('authPassword').value;
        if (authMode === 'register') {
            if (auth.users[email]) return alert("Email belegt.");
            auth.users[email] = { email, pass, history: [], stats: { sims: 0, best: '--' }, achievements: [] };
            auth.saveUsers();
            alert("Konto erstellt! Bitte anmelden.");
            switchAuthMode('login');
        } else {
            const user = auth.users[email];
            if (user && user.pass === pass) {
                auth.currentUser = user;
                if (!auth.currentUser.achievements) auth.currentUser.achievements = [];
                localStorage.setItem('sim_current_user', JSON.stringify(user));
                auth.unlockAchievement('persistent');
                updateAuthUI();
                updateStoryLocking();
                els.authMenu.classList.add('hidden');
            } else alert("Falsche Daten.");
        }
    });

    els.logoutBtn?.addEventListener('click', () => {
        auth.currentUser = null;
        localStorage.removeItem('sim_current_user');
        updateAuthUI();
        els.profileMenu.classList.add('hidden');
    });

    els.openAchBtn?.addEventListener('click', () => {
        if (auth.currentUser) { renderAchievements(); els.achMenu.classList.remove('hidden'); }
        else alert("Bitte anmelden.");
    });
    [els.closeAch, els.closeAchBottom].forEach(btn => btn?.addEventListener('click', () => els.achMenu.classList.add('hidden')));

    // Settings Menu
    els.openSettingsBtn?.addEventListener('click', () => els.settingsMenu.classList.remove('hidden'));
    els.closeSettingsBtn?.addEventListener('click', () => els.settingsMenu.classList.add('hidden'));

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
                window.location.href = `storymode.html?level=${btn.dataset.level}`;
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
