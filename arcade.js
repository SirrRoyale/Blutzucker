
// arcade.js - Arcade Mode Simulation Logic

class Simulation {
    constructor() {
        this.bg = 100;
        this.metabolismRate = 0;
        this.time = { h: 8, m: 0 };
        this.totalMinutes = 0;
        this.activeBoluses = [];
        this.activeMeals = [];
        this.activeActivities = [];
        this.history = [];
        this.tracker = new DayTracker();
        this.isDead = false;
        this.autoRunInterval = null;
        this.autoRunSpeed = 100;
        this.daysSurvived = 0;
        this.activityCount = 0;
        this.dayEnded = false;
        this.initChart();
        this.updateHeaderAvatar();
        this.updateUI();
    }

    updateSyncIndicator(success) {
        const el = document.getElementById('syncStatus');
        const dot = el?.querySelector('.sync-dot');
        const text = document.getElementById('syncText');
        if (!el || !dot || !text) return;

        dot.className = success ? 'sync-dot' : 'sync-dot offline';
        text.textContent = success ? 'Synchronisiert' : 'Sync Fehler';
        el.classList.add('visible');
        setTimeout(() => el.classList.remove('visible'), 3000);
    }

    updateHeaderAvatar() {
        const el = document.getElementById('headerAvatar');
        if (el && this.auth && this.auth.currentUser && this.auth.currentUser.avatar) {
            el.innerHTML = `<img src="${this.auth.currentUser.avatar}" alt="Avatar">`;
        }
    }

    fullReset() {
        this.stopAutoRun();
        this.bg = 100;
        this.time = { h: 8, m: 0 };
        this.totalMinutes = 0;
        this.activeBoluses = [];
        this.activeMeals = [];
        this.activeActivities = [];
        this.history = [{ x: "08:00", y: 100 }];
        this.isDead = false;
        this.dayEnded = false;
        this.tracker.reset();
        document.getElementById('deathOverlay')?.classList.add('hidden');
        document.getElementById('resultsOverlay')?.classList.add('hidden');
        if (this.chart) {
            this.chart.data.labels = ["08:00"];
            this.chart.data.datasets[0].data = [100];
            this.chart.options.scales.y.max = 200;
            this.chart.update('none');
        }
        this.updateUI();
    }

    tick(minutes) {
        if (this.isDead || this.dayEnded) return;
        const rate = parseFloat(this.metabolismRate);
        this.bg += (isNaN(rate) ? 0 : rate / 60) * minutes;

        let drop = 0;
        this.activeBoluses.forEach(b => drop += b.getEffect(minutes));
        this.bg -= drop;

        let rise = 0;
        this.activeMeals.forEach(m => rise += m.getEffect(minutes));
        this.bg += rise;

        let sportDrop = 0;
        const currentIOB = parseFloat(this.getIOB());
        this.activeActivities.forEach(a => sportDrop += a.getEffect(minutes, currentIOB));
        this.bg -= sportDrop;

        this.processRandomEvents();

        this.activeBoluses = this.activeBoluses.filter(b => b.elapsed < b.duration);
        this.activeMeals = this.activeMeals.filter(m => m.elapsed < m.duration);
        this.activeActivities = this.activeActivities.filter(a => a.elapsed < a.duration);

        this.checkHealth();
        this.tracker.track(this.bg);

        this.time.m += minutes;
        this.totalMinutes += minutes;
        if (this.time.m >= 60) { this.time.h += Math.floor(this.time.m / 60); this.time.m %= 60; }
        if (this.time.h >= 24) this.time.h %= 24;

        if (this.totalMinutes >= 1440) {
            this.showDaySummary();
        }

        this.history.push({ x: this.formatTime(), y: Math.round(this.bg) });
        if (this.history.length > 288) this.history.shift();
    }

    processRandomEvents() {
        CONFIG.EVENTS.forEach(ev => {
            if (Math.random() < ev.probability) {
                this.bg += parseFloat(ev.effect) || 0;
                this.showNotification(ev.msg);
            }
        });
    }

    showNotification(msg) {
        const el = document.getElementById('eventNotification');
        const msgEl = document.getElementById('eventMessage');
        if (el && msgEl) {
            msgEl.textContent = msg;
            el.classList.remove('hidden');
            if (this.notifTimeout) clearTimeout(this.notifTimeout);
            this.notifTimeout = setTimeout(() => el.classList.add('hidden'), 5000);
        }
    }

    checkHealth() {
        if (isNaN(this.bg)) this.bg = 100;
        if (this.bg <= CONFIG.DEATH_LOW) this.die(`Hypoglykämischer Schock! (Blutzucker < ${CONFIG.DEATH_LOW})`);
        else if (this.bg >= CONFIG.DEATH_HIGH) this.die(`Ketoazidotisches Koma! (Blutzucker > ${CONFIG.DEATH_HIGH})`);
        else if (this.bg <= CONFIG.WARN_LOW) this.setStatus("Niedriger Blutzucker! 🍎", "warning warning-pulse");
        else if (this.bg >= CONFIG.WARN_HIGH) this.setStatus("Hoher Blutzucker! 💉", "warning warning-pulse");
        else this.setStatus("STATUS: OK", "");
    }

    setStatus(msg, cls) {
        const statusEl = document.getElementById('healthStatus');
        if (statusEl) {
            statusEl.textContent = msg;
            statusEl.className = "health-status " + cls;
        }
    }

    die(reason) {
        this.isDead = true;
        this.stopAutoRun();
        const overlay = document.getElementById('deathOverlay');
        if (overlay) {
            const p = overlay.querySelector('p');
            if (p) p.textContent = reason;
            overlay.classList.remove('hidden');
        }
    }

    revive() {
        this.isDead = false;
        this.bg = 100;
        this.activeBoluses = [];
        this.activeMeals = [];
        this.activeActivities = [];
        document.getElementById('deathOverlay')?.classList.add('hidden');
        this.updateUI();
    }

    getIOB() { return this.activeBoluses.reduce((acc, b) => acc + (b.amount || 0), 0).toFixed(1); }
    getCOB() { return this.activeMeals.reduce((acc, m) => acc + (m.carbs || 0), 0).toFixed(0); }

    addInsulin(units, type = 'BOLUS') { if (units > 0 && !this.isDead) this.activeBoluses.push(new InsulinEffect(units, type)); }
    addCarbs(grams, type = 'NORMAL') { if (grams > 0 && !this.isDead) this.activeMeals.push(new MealEffect(grams, type)); }
    addActivity(type) {
        if (this.isDead) return;
        this.activeActivities.push(new SportEffect(type));
        this.activityCount++;
        if (this.auth && this.activityCount >= 5) this.auth.unlockAchievement('sporty');
    }

    async showDaySummary() {
        const stats = this.tracker.getScore();
        this.stopAutoRun();
        this.dayEnded = true;
        this.daysSurvived++;
        try {
            if (this.auth) {
                await this.auth.saveResult(stats);
                await this.auth.unlockAchievement('survive_day');
                if (stats.tir === 100) await this.auth.unlockAchievement('perfect_tir');
                if (stats.grade === 'A') await this.auth.unlockAchievement('grade_a');
            }
        } catch (e) {
            console.error("Auth save failed:", e);
        }
        const overlay = document.getElementById('resultsOverlay');
        if (overlay) {
            document.getElementById('resTIR').textContent = stats.tir + "%";
            document.getElementById('resHypos').textContent = stats.hypos;
            document.getElementById('resHypers').textContent = stats.hypers;
            const gradeEl = document.getElementById('resGrade');
            if (gradeEl) {
                gradeEl.textContent = stats.grade;
                gradeEl.className = 'res-grade grade-' + stats.grade.toLowerCase();
            }
            overlay.classList.remove('hidden');
        }
    }

    run(hours) {
        if (this.isDead) return;
        const steps = (hours * 60) / CONFIG.TIME_STEP;
        for (let i = 0; i < steps; i++) {
            this.tick(CONFIG.TIME_STEP);
            if (this.isDead || this.dayEnded) break;
        }
        this.updateUI();
    }

    toggleAutoRun() { this.autoRunInterval ? this.stopAutoRun() : this.startAutoRun(); }

    startAutoRun() {
        if (this.isDead) return;
        const btn = document.getElementById('autoRunBtn');
        if (btn) { btn.innerHTML = "⏸ Stop"; btn.classList.add('danger'); }
        this.autoRunInterval = setInterval(() => {
            this.tick(CONFIG.TIME_STEP);
            this.updateUI();
            if (this.isDead || this.dayEnded) this.stopAutoRun();
        }, this.autoRunSpeed);
    }

    stopAutoRun() {
        clearInterval(this.autoRunInterval);
        this.autoRunInterval = null;
        const btn = document.getElementById('autoRunBtn');
        if (btn) { btn.innerHTML = "▶ Run"; btn.classList.remove('danger'); }
    }

    setSpeed(ms) { this.autoRunSpeed = ms; if (this.autoRunInterval) { this.stopAutoRun(); this.startAutoRun(); } }
    formatTime() { return `${String(this.time.h).padStart(2, '0')}:${String(this.time.m).padStart(2, '0')}`; }

    updateUI() {
        document.getElementById('timeDisplay').textContent = this.formatTime();
        const bgEl = document.getElementById('bgDisplay');
        const dashboard = document.querySelector('.dashboard-container');
        const val = Math.round(this.bg);
        if (!isNaN(val)) {
            bgEl.textContent = val;
            dashboard.classList.remove('state-warning', 'state-critical');
            if (val < CONFIG.DEATH_LOW || val >= CONFIG.DEATH_HIGH) {
                bgEl.style.color = 'var(--danger-color)';
                dashboard.classList.add('state-critical');
            } else if (val < CONFIG.WARN_LOW || val > CONFIG.WARN_HIGH) {
                bgEl.style.color = 'var(--warn-color)';
                dashboard.classList.add('state-warning');
            } else {
                bgEl.style.color = 'var(--accent-color)';
            }
        }
        document.getElementById('iobDisplay').textContent = this.getIOB();
        document.getElementById('cobDisplay').textContent = this.getCOB();
        if (this.chart) {
            this.chart.data.labels = this.history.map(h => h.x);
            this.chart.data.datasets[0].data = this.history.map(h => h.y);
            const historyValues = this.history.map(h => h.y);
            const maxVal = Math.max(val, ...historyValues);
            let newMax = maxVal > 580 ? Math.ceil((maxVal + 50) / 50) * 50 : (maxVal > 380 ? 600 : (maxVal > 180 ? 400 : 200));
            this.chart.options.scales.y.max = newMax;
            const ds = this.chart.data.datasets[0];
            if (val < CONFIG.DEATH_LOW || val >= CONFIG.DEATH_HIGH) { ds.borderColor = '#d50000'; ds.backgroundColor = 'rgba(213, 0, 0, 0.2)'; }
            else if (val < CONFIG.WARN_LOW || val > CONFIG.WARN_HIGH) { ds.borderColor = '#ff6d00'; ds.backgroundColor = 'rgba(255, 109, 0, 0.2)'; }
            else { ds.borderColor = '#00c853'; ds.backgroundColor = 'rgba(0, 200, 83, 0.2)'; }
            this.chart.update('none');
        }
    }

    initChart() {
        const canvas = document.getElementById('bgChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (this.history.length === 0) this.history.push({ x: this.formatTime(), y: this.bg });
        if (typeof Chart === 'undefined') { setTimeout(() => this.initChart(), 500); return; }
        const plugins = { legend: { display: false } };
        const annotationPlugin = window['chartjs-plugin-annotation'];
        if (annotationPlugin) {
            plugins.annotation = {
                annotations: {
                    low: { type: 'line', yMin: 70, yMax: 70, borderColor: 'rgba(255, 23, 68, 0.5)', borderWidth: 1, borderDash: [5, 5] },
                    high: { type: 'line', yMin: 180, yMax: 180, borderColor: 'rgba(255, 145, 0, 0.5)', borderWidth: 1, borderDash: [5, 5] },
                    deadLow: { type: 'box', yMin: 0, yMax: 30, backgroundColor: 'rgba(255, 23, 68, 0.2)', borderWidth: 0 },
                    deadHigh: { type: 'box', yMin: 600, yMax: 1000, backgroundColor: 'rgba(255, 23, 68, 0.2)', borderWidth: 0 }
                }
            };
        }
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.history.map(h => h.x),
                datasets: [{ data: this.history.map(h => h.y), borderColor: '#00c853', backgroundColor: 'rgba(0, 200, 83, 0.2)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    y: { min: 0, max: 400, grid: { color: 'rgba(0,0,0,0.05)' } },
                    x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { maxTicksLimit: 8 } }
                },
                plugins: plugins
            }
        });
    }

    updateChartTheme(isDark) {
        if (!this.chart) return;
        const textColor = isDark ? '#e0e0e0' : '#444';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
        this.chart.options.scales.x.ticks.color = textColor;
        this.chart.options.scales.x.grid.color = gridColor;
        this.chart.options.scales.y.ticks.color = textColor;
        this.chart.options.scales.y.grid.color = gridColor;
        this.chart.update('none');
    }
}

// Arcade Initialization
document.addEventListener('DOMContentLoaded', () => {
    const sim = new Simulation();
    sim.auth = new AuthManager(sim);
    sim.updateHeaderAvatar(); // Re-trigger now that auth is ready

    // Character Selection
    const typeButtons = document.querySelectorAll('.body-type-btn');
    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (type === 'custom') { document.getElementById('customParams').classList.remove('hidden'); return; }
            document.getElementById('customParams').classList.add('hidden');
            startGame(btn.querySelector('.label').textContent, btn.querySelector('.icon').textContent, parseFloat(btn.dataset.rate));
        });
    });

    document.getElementById('startCustomBtn')?.addEventListener('click', () => {
        CONFIG.ISF = parseFloat(document.getElementById('customISF').value) || CONFIG.ISF;
        CONFIG.ICR = parseFloat(document.getElementById('customICR').value) || CONFIG.ICR;
        startGame("Benutzerdefiniert", "⚙️", parseFloat(document.getElementById('customRate').value));
    });

    function startGame(typeName, icon, rate) {
        sim.metabolismRate = rate;
        document.getElementById('startScreen').classList.add('hidden');
        document.querySelector('.dashboard-container').classList.remove('blur-background');
        document.getElementById('bodyTypeDisplay').querySelector('.icon').textContent = icon;
        document.getElementById('bodyTypeDisplay').querySelector('.text').textContent = typeName;
    }

    // Action Buttons
    document.querySelectorAll('.meal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const carbs = (parseFloat(btn.dataset.carbs) * CONFIG.ICR) / CONFIG.ISF;
            sim.addCarbs(carbs, btn.dataset.type);
            sim.updateUI();
        });
    });

    document.querySelectorAll('.insulin-btn:not(.correction)').forEach(btn => {
        btn.addEventListener('click', () => {
            sim.addInsulin(parseFloat(btn.dataset.effect) / CONFIG.ISF, btn.dataset.type);
            sim.updateUI();
        });
    });

    document.getElementById('correctionBtn')?.addEventListener('click', () => {
        if (sim.bg > CONFIG.TARGET_BG) {
            sim.addInsulin(Math.min(Math.max(sim.bg - CONFIG.TARGET_BG, 40), 80) / CONFIG.ISF, 'BOLUS');
            sim.updateUI();
        }
    });

    document.querySelectorAll('.sport-btn').forEach(btn => {
        btn.addEventListener('click', () => { sim.addActivity(btn.dataset.type); sim.updateUI(); });
    });

    // Controls
    document.getElementById('nextHourBtn')?.addEventListener('click', () => sim.run(1));
    document.getElementById('autoRunBtn')?.addEventListener('click', () => sim.toggleAutoRun());
    document.getElementById('speedSlider')?.addEventListener('input', (e) => sim.setSpeed(600 - parseInt(e.target.value)));
    document.getElementById('resetBtn')?.addEventListener('click', () => sim.fullReset());
    document.getElementById('respawnBtn')?.addEventListener('click', () => sim.fullReset());
    document.querySelector('#resultsOverlay .restart-btn')?.addEventListener('click', () => {
        sim.totalMinutes = 0;
        sim.tracker.reset();
        sim.dayEnded = false;
        document.getElementById('resultsOverlay').classList.add('hidden');
        sim.updateUI();
    });
    document.getElementById('reviveBtn')?.addEventListener('click', () => sim.revive());

    // Theme handle (simple)
    if (localStorage.getItem('sim_theme') === 'dark') {
        document.body.classList.add('dark-mode');
        document.documentElement.classList.add('dark-mode');
        sim.updateChartTheme(true);
    }

    // Header click to go back
    document.getElementById('headerTitle')?.addEventListener('click', () => window.location.href = 'index.html');
    document.getElementById('backToMainMenuBtn')?.addEventListener('click', () => window.location.href = 'index.html');

    // Accordion Logic
    const collapsibles = document.querySelectorAll('.collapsible-card');
    collapsibles.forEach((card, idx) => {
        if (idx !== 0) card.classList.add('collapsed');
        card.querySelector('.collapse-toggle')?.addEventListener('click', () => {
            const isCollapsed = card.classList.contains('collapsed');
            collapsibles.forEach(c => c.classList.add('collapsed'));
            if (isCollapsed) card.classList.remove('collapsed');
        });
    });
});
