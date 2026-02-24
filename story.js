
// story.js - Story Mode Simulation Logic

const LEVELS = {
    1: {
        title: "Level 1: Stabilisierung",
        desc: "Bringe den hohen Blutzucker (220) in den Zielbereich (100-140) und halte ihn dort für 2 Stunden.",
        startBG: 220,
        startTime: { h: 10, m: 0 },
        metabolism: -3,
        goal: "Zielbereich 100-140 mg/dL für 2h halten.",
        limits: { meals: 1, insulin: 2, sport: 0 },
        isWon: (sim) => sim.inRangeMinutes >= 120,
        failCond: (sim) => sim.bg < 60 || sim.bg > 300,
        achId: 'story_lvl1'
    },
    2: {
        title: "Level 2: Mahlzeiten-Meister",
        desc: "Ein Essen (60g) steht an. Überstehe 6 Stunden, ohne 220 mg/dL zu überschreiten.",
        startBG: 100,
        startTime: { h: 12, m: 0 },
        metabolism: -3,
        goal: "6h überleben, BZ immer unter 220 mg/dL.",
        limits: { meals: 1, insulin: 8, sport: 0 },
        isWon: (sim) => sim.totalMinutes >= 360,
        failCond: (sim) => sim.bg > 220 || sim.bg < 40,
        achId: 'story_lvl2'
    },
    3: {
        title: "Level 3: Sportliche Höchstleistung",
        desc: "Absolviere 3 Sporteinheiten und halte den BZ zwischen 80-150 mg/dL.",
        startBG: 150,
        startTime: { h: 14, m: 0 },
        metabolism: -3,
        goal: "3 Sport-Sessions beenden, BZ 80-150 halten.",
        limits: { meals: 2, insulin: 2, sport: 3 },
        isWon: (sim) => sim.usedActions.sport >= 3 && sim.totalMinutes >= 240,
        failCond: (sim) => sim.bg < 80 || sim.bg > 180,
        achId: 'story_lvl3'
    },
    4: {
        title: "Level 4: Die Nachtwache",
        desc: "Es ist Nacht (22:00). Halte den BZ bis 06:00 Uhr zwischen 90-130 mg/dL. Vorsicht vor der Drift!",
        startBG: 110,
        startTime: { h: 22, m: 0 },
        metabolism: -4, // Night metabolism
        goal: "Bis 06:00 Uhr im Bereich 80-140 mg/dL bleiben.",
        limits: { meals: 3, insulin: 3, sport: 0 },
        isWon: (sim) => sim.totalMinutes >= 480, // 8 hours
        failCond: (sim) => sim.bg < 80 || sim.bg > 140,
        achId: 'story_lvl4'
    },
    5: {
        title: "Level 5: Perfekter Tag",
        desc: "Ein ganzer Tag (24h). Bereich 70-150 mg/dL. Max. 15 Min. Abweichung erlaubt.",
        startBG: 100,
        startTime: { h: 0, m: 0 },
        metabolism: -3,
        goal: "24h überleben, max. 15 Min. außerhalb 70-150.",
        limits: { meals: 6, insulin: 6, sport: 4 },
        isWon: (sim) => sim.totalMinutes >= 1440 && (sim.totalMinutes - sim.inRangeMinutes) <= 15,
        failCond: (sim) => (sim.totalMinutes - sim.inRangeMinutes) > 15 || sim.bg < 40 || sim.bg > 300,
        achId: 'story_lvl5'
    }
};

class StorySimulation {
    constructor(levelNum) {
        this.levelNum = parseInt(levelNum) || 1;
        this.level = LEVELS[this.levelNum];
        this.reset();
        this.initChart();
        this.updateHeaderAvatar();
        this.updateUI();
    }

    updateHeaderAvatar() {
        const el = document.getElementById('headerAvatar');
        if (el && this.auth && this.auth.currentUser && this.auth.currentUser.avatar) {
            el.innerHTML = `<img src="${this.auth.currentUser.avatar}" alt="Avatar">`;
        }
    }

    reset() {
        this.bg = this.level.startBG;
        this.metabolismRate = this.level.metabolism;
        this.time = { h: this.level.startTime.h, m: this.level.startTime.m };
        this.totalMinutes = 0;
        this.inRangeMinutes = 0;
        this.activeBoluses = [];
        this.activeMeals = [];
        this.activeActivities = [];
        this.usedActions = { meals: 0, insulin: 0, sport: 0 };
        this.history = [{ x: this.formatTime(), y: Math.round(this.bg) }];
        this.isFinished = false;
        this.autoRunInterval = null;
        this.autoRunSpeed = 100;

        document.getElementById('deathOverlay').classList.add('hidden');
        document.getElementById('winOverlay').classList.add('hidden');
        if (this.chart) {
            this.chart.data.labels = [this.formatTime()];
            this.chart.data.datasets[0].data = [Math.round(this.bg)];
            this.chart.update('none');
        }

        // Specific Level Start Actions
        if (this.levelNum === 2) {
            this.showNotification("Das Essen kommt in 3 Sekunden...");
            setTimeout(() => this.addCarbs(60, 'NORMAL'), 3000); // 60g after 3s
        }
    }

    tick(minutes) {
        if (this.isFinished) return;
        this.bg += (this.metabolismRate / 60) * minutes;

        let drop = 0;
        this.activeBoluses.forEach(b => drop += b.getEffect(minutes));
        this.bg -= drop;

        let rise = 0;
        this.activeMeals.forEach(m => rise += m.getEffect(minutes));
        this.bg += rise;

        let sportDrop = 0;
        const currentIOB = this.activeBoluses.reduce((acc, b) => acc + (b.amount || 0), 0);
        this.activeActivities.forEach(a => sportDrop += a.getEffect(minutes, currentIOB));
        this.bg -= sportDrop;

        this.activeBoluses = this.activeBoluses.filter(b => b.elapsed < b.duration);
        this.activeMeals = this.activeMeals.filter(m => m.elapsed < m.duration);
        this.activeActivities = this.activeActivities.filter(a => a.elapsed < a.duration);

        // Survival Difficulty: Levels 1-5 have their own range checking
        const lo = this.levelNum === 1 ? 100 : (this.levelNum === 4 ? 90 : 70);
        const hi = this.levelNum === 1 ? 140 : (this.levelNum === 4 ? 130 : 150);
        if (this.bg >= lo && this.bg <= hi) this.inRangeMinutes += minutes;

        this.time.m += minutes;
        this.totalMinutes += minutes;
        if (this.time.m >= 60) { this.time.h += Math.floor(this.time.m / 60); this.time.m %= 60; }
        if (this.time.h >= 24) this.time.h %= 24;

        this.history.push({ x: this.formatTime(), y: Math.round(this.bg) });
        if (this.history.length > 288) this.history.shift();

        this.checkStatus();
    }

    checkStatus() {
        if (this.level.failCond(this)) return this.fail("Ziel verfehlt!");
        if (this.level.isWon(this)) return this.win();
    }

    fail(reason) {
        this.isFinished = true;
        clearInterval(this.autoRunInterval);
        document.getElementById('failReason').textContent = reason;
        document.getElementById('deathOverlay').classList.remove('hidden');
    }

    win() {
        this.isFinished = true;
        clearInterval(this.autoRunInterval);
        if (this.auth) {
            this.auth.unlockAchievement(this.level.achId);
        }
        document.getElementById('winMessage').textContent = `Gut gemacht! Du hast ${this.level.title} abgeschlossen.`;
        document.getElementById('winOverlay').classList.remove('hidden');
    }

    addInsulin(units, type = 'BOLUS') {
        if (this.isFinished) return;
        if (this.usedActions.insulin >= this.level.limits.insulin) {
            this.showNotification("Insulin-Limit für dieses Level erreicht! 💉");
            return;
        }
        this.activeBoluses.push(new InsulinEffect(units, type));
        this.usedActions.insulin++;
        this.updateUI();
    }

    addCarbs(grams, type = 'NORMAL') {
        if (this.isFinished) return;
        if (this.usedActions.meals >= this.level.limits.meals) {
            this.showNotification("Essen-Limit für dieses Level erreicht! 🍎");
            return;
        }
        this.activeMeals.push(new MealEffect(grams, type));
        this.usedActions.meals++;
        this.updateUI();
    }

    addActivity(type) {
        if (this.isFinished) return;
        if (this.usedActions.sport >= this.level.limits.sport) {
            this.showNotification("Sport-Limit für dieses Level erreicht! 🏃");
            return;
        }
        this.activeActivities.push(new SportEffect(type));
        this.usedActions.sport++;
        this.updateUI();
    }

    showNotification(msg) {
        const el = document.getElementById('eventNotification');
        const msgEl = document.getElementById('eventMessage');
        if (el && msgEl) {
            msgEl.textContent = msg;
            el.classList.remove('hidden');
            if (this.notifTimeout) clearTimeout(this.notifTimeout);
            this.notifTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
        }
    }

    // Reuse UI helpers from arcade (simplified)
    formatTime() { return `${String(this.time.h).padStart(2, '0')}:${String(this.time.m).padStart(2, '0')}`; }
    updateUI() {
        document.getElementById('timeDisplay').textContent = this.formatTime();
        document.getElementById('bgDisplay').textContent = Math.round(this.bg);
        document.getElementById('levelTitle').textContent = this.level.title;
        document.getElementById('objectiveText').textContent = this.level.goal;

        let progressStr = "";
        if (this.levelNum === 1) progressStr = `Stabilität: ${Math.floor(this.inRangeMinutes / 60)}h ${this.inRangeMinutes % 60}m / 2h`;
        else if (this.levelNum === 3) progressStr = `Sport: ${this.usedActions.sport}/3 | Zeit: ${Math.floor(this.totalMinutes / 60)}h ${this.totalMinutes % 60}m`;
        else if (this.levelNum === 5) progressStr = `Out-of-Range: ${Math.max(0, this.totalMinutes - this.inRangeMinutes)} / 15 Min`;
        else progressStr = `Zeit vergangen: ${Math.floor(this.totalMinutes / 60)}h ${this.totalMinutes % 60}m`;

        document.getElementById('objectiveProgress').textContent = progressStr;

        // Update Limits UI
        document.getElementById('limitMeals').textContent = `🍎 ${this.level.limits.meals - this.usedActions.meals}`;
        document.getElementById('limitInsulin').textContent = `💉 ${this.level.limits.insulin - this.usedActions.insulin}`;
        document.getElementById('limitSport').textContent = `🏃 ${this.level.limits.sport - this.usedActions.sport}`;

        document.getElementById('iobDisplay').textContent = this.activeBoluses.reduce((acc, b) => acc + (b.amount || 0), 0).toFixed(1);
        document.getElementById('cobDisplay').textContent = this.activeMeals.reduce((acc, m) => acc + (m.carbs || 0), 0).toFixed(0);

        if (this.chart) {
            this.chart.data.labels = this.history.map(h => h.x);
            this.chart.data.datasets[0].data = this.history.map(h => h.y);
            this.chart.update('none');
        }
    }

    initChart() {
        const canvas = document.getElementById('bgChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (typeof Chart === 'undefined') { setTimeout(() => this.initChart(), 500); return; }
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.history.map(h => h.x),
                datasets: [{ data: this.history.map(h => h.y), borderColor: '#00c853', backgroundColor: 'rgba(0, 200, 83, 0.2)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    y: { min: 0, max: 400, grid: { color: 'rgba(0,0,0,0.05)' } },
                    x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { maxTicksLimit: 8 } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    run(hours) {
        if (this.isFinished) return;
        const steps = (hours * 60) / 5;
        for (let i = 0; i < steps; i++) { this.tick(5); if (this.isFinished) break; }
        this.updateUI();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sim = new StorySimulation(urlParams.get('level') || 1);
    sim.auth = new AuthManager(sim);
    sim.updateHeaderAvatar(); // Re-trigger now that auth is ready

    document.getElementById('nextHourBtn').addEventListener('click', () => sim.run(1));
    document.getElementById('autoRunBtn').addEventListener('click', () => {
        if (sim.autoRunInterval) {
            clearInterval(sim.autoRunInterval);
            sim.autoRunInterval = null;
            document.getElementById('autoRunBtn').innerHTML = "▶ Run";
        } else {
            sim.autoRunInterval = setInterval(() => {
                sim.tick(5);
                sim.updateUI();
                if (sim.isFinished) clearInterval(sim.autoRunInterval);
            }, 100);
            document.getElementById('autoRunBtn').innerHTML = "⏸ Stop";
        }
    });

    document.getElementById('resetBtn').addEventListener('click', () => sim.reset());
    document.getElementById('retryBtn').addEventListener('click', () => sim.reset());
    document.getElementById('nextLevelBtn').addEventListener('click', () => {
        if (sim.levelNum < 5) window.location.href = `storymode.html?level=${sim.levelNum + 1}`;
        else window.location.href = 'index.html';
    });

    document.getElementById('shareLevelBtn')?.addEventListener('click', () => {
        const user = sim.auth?.currentUser ? (sim.auth.currentUser.username || sim.auth.currentUser.email.split('@')[0]) : 'Ein Spieler';
        const avatar = sim.auth?.currentUser?.avatar || '';
        const url = new URL(window.location.href);

        // Remove "Level X: " from title if it exists to prevent duplication
        const cleanTitle = sim.level.title.replace(/^Level \d+: /, '');

        const shareUrl = `${url.origin}${url.pathname.replace('storymode.html', 'share.html')}?u=${encodeURIComponent(user)}&l=${sim.levelNum}&t=${encodeURIComponent(cleanTitle)}&a=${encodeURIComponent(avatar)}`;

        navigator.clipboard.writeText(shareUrl).then(() => {
            alert("Link in Zwischenablage kopiert! 🔗\nTeile ihn mit deinen Freunden.");
        }).catch(err => {
            console.error('Kopieren fehlgeschlagen:', err);
            alert("Fehler beim Kopieren. Hier ist dein Link:\n" + shareUrl);
        });
    });

    document.querySelectorAll('.meal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            sim.addCarbs((parseFloat(btn.dataset.carbs) * CONFIG.ICR) / CONFIG.ISF, btn.dataset.type);
        });
    });

    document.querySelectorAll('.insulin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id === 'correctionBtn') {
                if (sim.bg > 100) sim.addInsulin(Math.min(Math.max(sim.bg - 100, 40), 80) / CONFIG.ISF, 'BOLUS');
            } else {
                sim.addInsulin(parseFloat(btn.dataset.effect) / CONFIG.ISF, btn.dataset.type);
            }
        });
    });

    document.querySelectorAll('.sport-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            sim.addActivity(btn.dataset.type);
        });
    });

    // Theme logic
    if (localStorage.getItem('sim_theme') === 'dark') {
        document.body.classList.add('dark-mode');
        document.documentElement.classList.add('dark-mode');
    }

    document.getElementById('headerTitle').addEventListener('click', () => window.location.href = 'index.html');

    // Accordion
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
