const API_BASE = "https://blutzucker-cfad.onrender.com";
(function () { // Wrap in IIFE to avoid global scope pollution
  // --- Constants & Config ---
  const CONFIG = {
    ISF: 40,        // Insulin Sensitivity Factor: 1 Unit drops BG by 40 mg/dL
    ICR: 10,        // Insulin-to-Carb Ratio: 1 Unit covers 10g Carbs
    TIME_STEP: 5,   // Minutes per tick
    TARGET_BG: 100,

    // Health Limits
    DEATH_LOW: 40,
    DEATH_HIGH: 600,
    WARN_LOW: 70,
    WARN_HIGH: 250,
    RANGE_MIN: 70,
    RANGE_MAX: 140,

    // Meal Types
    MEALS: {
      FAST: { label: "Süßigkeiten", duration: 90, peak: 30, multiplier: 1.2 },
      NORMAL: { label: "Mahlzeit", duration: 180, peak: 60, multiplier: 1.0 },
      SLOW: { label: "Vollkorn", duration: 300, peak: 120, multiplier: 0.8 }
    },

    // Sport Types
    SPORT: {
      LIGHT: { label: "Spaziergang", effect: 15, duration: 60 },
      MEDIUM: { label: "Joggen", effect: 40, duration: 45 },
      HEAVY: { label: "Intensiv", effect: 80, duration: 30 }
    },

    // Insulin Types
    INSULIN: {
      BOLUS: { label: "Bolus", duration: 240, peak: 60 },
      BASAL: { label: "Basal", duration: 1440, peak: 360 } // 24h
    },

    // Random Events (Lower Frequencies as requested)
    EVENTS: [
      { id: 'stress', label: "Stress", probability: 0.015, effect: 15, msg: "Stress lässt den Zucker steigen! 😰" },
      { id: 'snack', label: "Snack", probability: 0.01, effect: 10, msg: "Heimlicher Snack ohne Insulin! 🍪" },
      { id: 'sick', label: "Infekt", probability: 0.005, effect: 30, msg: "Ein Infekt bahnt sich an... 🤒" },
      { id: 'forgot', label: "Sport?", probability: 0.008, effect: -15, msg: "Längere Laufwege als gedacht. 🚶" }
    ]
  };

  // --- Chart Global Defaults for Light Mode ---
  if (window.Chart) {
    Chart.defaults.color = '#444'; // Dark text
    Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.1)'; // Light borders
  }

  class SoundManager {
    constructor() {
      this.masterVolume = 0.7;
      this.sfxVolume = 0.8;
      this.sounds = {};

      // Preparation for future sounds
      // this.loadSound('click', 'assets/sounds/click.mp3');
      // this.loadSound('alert', 'assets/sounds/alert.mp3');
    }

    setMasterVolume(value) {
      this.masterVolume = value / 100;
      console.log(`Master Volume set to: ${this.masterVolume}`);
    }

    setSfxVolume(value) {
      this.sfxVolume = value / 100;
      console.log(`SFX Volume set to: ${this.sfxVolume}`);
    }

    play(name) {
      if (this.sounds[name]) {
        const sound = this.sounds[name].cloneNode();
        sound.volume = this.masterVolume * this.sfxVolume;
        sound.play().catch(e => console.warn("Sound play failed:", e));
      } else {
        console.log(`Sound placeholder: Playing ${name}...`);
      }
    }

    // Helper to load sounds
    loadSound(name, src) {
      const audio = new Audio(src);
      this.sounds[name] = audio;
    }
  }

  const sounds = new SoundManager();

  // --- Helper Classes ---

  class InsulinEffect {
    constructor(amount, typeKey = 'BOLUS') {
      const type = CONFIG.INSULIN[typeKey];
      this.initialAmount = amount;
      this.amount = amount;
      this.typeKey = typeKey;
      this.duration = type.duration;
      this.elapsed = 0;
    }

    getEffect(minutes) {
      if (this.elapsed >= this.duration) return 0;

      // Simple linear model for now, could be improved to a curve
      // Basal is much flatter.
      const effectBase = (this.initialAmount * CONFIG.ISF) * (minutes / this.duration);

      this.elapsed += minutes;
      this.amount = Math.max(0, this.initialAmount * (1 - (this.elapsed / this.duration)));
      return effectBase;
    }
  }

  class MealEffect {
    constructor(carbs, typeKey = 'NORMAL') {
      const type = CONFIG.MEALS[typeKey];
      this.initialCarbs = carbs;
      this.carbs = carbs;
      this.typeKey = typeKey;
      this.duration = type.duration;
      this.peak = type.peak;
      this.elapsed = 0;
    }

    getEffect(minutes) {
      if (this.elapsed >= this.duration) return 0;

      const riseFactor = CONFIG.ISF / CONFIG.ICR;
      const totalRise = this.initialCarbs * riseFactor;

      // Modified triangular curve for peak effect
      let intensity = 0;
      if (this.elapsed < this.peak) {
        // Rising to peak
        intensity = (this.elapsed / this.peak);
      } else {
        // Falling from peak
        intensity = 1 - ((this.elapsed - this.peak) / (this.duration - this.peak));
      }

      // Normalize intensity so area under curve matches totalRise
      // Area = 0.5 * base * height = 0.5 * duration * 1
      // Average intensity = 0.5. Total effect = totalRise.
      // effect per minute = (totalRise / duration) * (intensity / average_intensity)
      const effect = (totalRise / this.duration) * (intensity / 0.5) * (minutes / 1);

      this.elapsed += minutes;
      this.carbs = Math.max(0, this.initialCarbs * (1 - (this.elapsed / this.duration)));
      return effect;
    }
  }

  class SportEffect {
    constructor(typeKey) {
      const type = CONFIG.SPORT[typeKey];
      this.typeKey = typeKey;
      this.effect = type.effect;
      this.duration = type.duration;
      this.elapsed = 0;
    }

    getEffect(minutes, currentIOB) {
      if (this.elapsed >= this.duration) return 0;

      // Sport intensity * minutes. If IOB > 0, effect is stronger (Hypo risk)
      let multiplier = 1.0;
      if (currentIOB > 0.5) multiplier = 1.5; // Risk factor

      const drop = (this.effect / this.duration) * minutes * multiplier;
      this.elapsed += minutes;
      return drop;
    }
  }

  class DayTracker {
    constructor() {
      this.reset();
    }
    reset() {
      this.totalSteps = 0;
      this.inRangeSteps = 0;
      this.hypos = 0;
      this.hypers = 0;
      this.lastState = 'normal'; // 'hypo', 'hyper', 'normal'
    }
    track(bg) {
      this.totalSteps++;
      if (bg >= CONFIG.RANGE_MIN && bg <= CONFIG.RANGE_MAX) {
        this.inRangeSteps++;
      }

      if (bg < CONFIG.WARN_LOW) {
        if (this.lastState !== 'hypo') this.hypos++;
        this.lastState = 'hypo';
      } else if (bg > CONFIG.WARN_HIGH) {
        if (this.lastState !== 'hyper') this.hypers++;
        this.lastState = 'hyper';
      } else {
        this.lastState = 'normal';
      }
    }
    getScore() {
      const tir = (this.inRangeSteps / this.totalSteps) * 100;
      let grade = 'F';
      if (tir > 90 && this.hypos === 0) grade = 'A';
      else if (tir > 75) grade = 'B';
      else if (tir > 50) grade = 'C';
      else if (tir > 25) grade = 'D';

      return { tir: Math.round(tir), hypos: this.hypos, hypers: this.hypers, grade };
    }
  }



  // --- Auth & Profile Manager ---
  class AuthManager {
    constructor(simulation) {
      this.sim = simulation;
      this.currentUser = null;
      this.token = localStorage.getItem("token") || null;

      this.achievements = [
        { id: 'persistent', icon: '🤝', title: 'Dranbleiber', desc: 'Erstelle ein Konto und melde dich an.' },
        { id: 'survive_day', icon: '🏆', title: 'Überlebenskünstler', desc: 'Überlebe einen vollen Tag in der Simulation.' },
        { id: 'perfect_tir', icon: '🎯', title: 'Meister der Zeit', desc: 'Erreiche 100% Time in Range für einen Tag.' },
        { id: 'grade_a', icon: '📜', title: 'Musterschüler', desc: 'Erreiche die Bestnote A bei der Tagesauswertung.' },
        { id: 'sporty', icon: '🏃', title: 'Sportskanone', desc: 'Schließe insgesamt 5 sportliche Aktivitäten ab.' },
        { id: 'early_bird', icon: '🌅', title: 'Frühaufsteher', desc: 'Starte eine Simulation vor 08:00 Uhr.' },
        { id: 'night_owl', icon: '🦉', title: 'Nachteule', desc: 'Simulation nach 22:00 Uhr aktiv.' },
        { id: 'hypo_profi', icon: '🍬', title: 'Hypo-Profi', desc: 'Behandle eine Unterzuckerung erfolgreich zurück in den Zielbereich.' },
        { id: 'discipline', icon: '🥗', title: 'Disziplin', desc: 'Verpasse 24 Stunden lang keine Mahlzeit.' },
        { id: 'marathon', icon: '🏁', title: 'Marathon', desc: 'Erreiche den 2. Tag im Überlebensmodus.' },
        { id: 'platinum', icon: '💎', title: 'Platin-Trophäe', desc: 'Sammle alle anderen Erfolge.' }
      ];

      this.initUI();
      this.updateStatusUI();
    }

    initUI() {
      // Elements
      this.els = {
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
        // Achievements
        openAchBtn: document.getElementById('openAchievementsBtn'),
        achMenu: document.getElementById('achievementsMenu'),
        achList: document.getElementById('achievementsList'),
        closeAch: document.getElementById('closeAchievementsBtn'),
        closeAchBottom: document.getElementById('closeAchievementsBtnBottom'),
        achCountPreview: document.querySelector('.achievement-count-preview'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn')
      };

      this.mode = 'login'; // 'login' or 'register'

      // Listeners
      if (this.els.openBtn) {
        this.els.openBtn.addEventListener('click', () => {
          if (this.currentUser) this.openProfile();
          else this.openAuth();
        });
      }

      [this.els.closeAuth, this.els.closeProfile].forEach(btn => {
        if (btn) btn.addEventListener('click', () => this.closeAll());
      });

      if (this.els.tabLogin) {
        this.els.tabLogin.addEventListener('click', () => this.switchMode('login'));
      }
      if (this.els.tabRegister) {
        this.els.tabRegister.addEventListener('click', () => this.switchMode('register'));
      }

      if (this.els.authForm) {
        this.els.authForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleAuth();
        });
      }

      if (this.els.logoutBtn) {
        this.els.logoutBtn.addEventListener('click', () => this.logout());
      }

      if (this.els.googleBtn) {
        this.els.googleBtn.addEventListener('click', () => {
          alert("Google Login ist in dieser Demo-Version nur ein Platzhalter. Bitte registriere dich normal.");
        });
      }

      if (this.els.openAchBtn) {
        this.els.openAchBtn.addEventListener('click', () => {
          if (this.currentUser) this.openAchievements();
          else alert("Bitte melde dich an, um deine Erfolge zu sehen.");
        });
      }

      [this.els.closeAch, this.els.closeAchBottom].forEach(btn => {
        if (btn) btn.addEventListener('click', () => {
          if (this.els.achMenu) this.els.achMenu.classList.add('hidden');
        });
      });

      if (this.els.clearHistoryBtn) {
        this.els.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
      }
    }

    switchMode(mode) {
      this.mode = mode;
      const title = document.getElementById('authTitle');
      if (title) title.textContent = mode === 'login' ? 'Anmelden' : 'Registrieren';
      if (this.els.tabLogin) this.els.tabLogin.classList.toggle('active', mode === 'login');
      if (this.els.tabRegister) this.els.tabRegister.classList.toggle('active', mode === 'register');
      const submit = document.getElementById('authSubmitBtn');
      if (submit) submit.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
    }

    async handleAuth() {
      const email = document.getElementById('authEmail').value;
      const pass = document.getElementById('authPassword').value;

      if (this.mode === 'register') {
        const res = await fetch(`${API_BASE}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass })
        });

        const data = await res.json();

        if (res.ok) {
          alert("Konto erstellt! Bitte anmelden.");
          this.switchMode('login');
        } else {
          alert(data.error);
        }

      } else {
        const res = await fetch(`${API_BASE}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass })
        });

        const data = await res.json();

        if (res.ok) {
          this.token = data.token;
          this.currentUser = data.user;

          localStorage.setItem("token", data.token);

          this.updateStatusUI();
          this.closeAll();
        } else {
          alert(data.error);
        }
      }
    }

    logout() {
      this.currentUser = null;
      this.token = null;
      localStorage.removeItem("token");
      this.updateStatusUI();
      this.closeAll();
    }

    openAuth() {
      if (this.els.authMenu) this.els.authMenu.classList.remove('hidden');
    }

    openAchievements() {
      this.renderAchievements();
      if (this.els.achMenu) this.els.achMenu.classList.remove('hidden');
    }

    renderAchievements() {
      if (!this.els.achList) return;
      this.els.achList.innerHTML = '';

      const earned = this.currentUser ? (this.currentUser.achievements || []) : [];

      this.achievements.forEach(ach => {
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
        this.els.achList.appendChild(div);
      });
    }

    async unlockAchievement(id) {
      if (!this.currentUser) return;

      try {
        await fetch(`${API_BASE}/api/achievement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: this.currentUser._id,
            achievement: id
          })
        });

        // Optional: lokal auch pushen für UI
        if (!this.currentUser.achievements) {
          this.currentUser.achievements = [];
        }

        if (!this.currentUser.achievements.includes(id)) {
          this.currentUser.achievements.push(id);
        }

        this.updateStatusUI();

        const ach = this.achievements.find(a => a.id === id);
        if (ach && this.sim) {
          this.sim.showNotification(`ERFOLG FREIGESCHALTET: ${ach.icon} ${ach.title}`);
        }

        this.checkPlatinum();

      } catch (err) {
        console.error("Achievement Fehler:", err);
      }
    }

    checkPlatinum() {
      if (!this.currentUser || this.currentUser.achievements.includes('platinum')) return;

      const normalAchIds = this.achievements.filter(a => a.id !== 'platinum').map(a => a.id);
      const earnedIds = this.currentUser.achievements;

      const allNormalEarned = normalAchIds.every(id => earnedIds.includes(id));

      if (allNormalEarned) {
        this.unlockAchievement('platinum');
      }
    }

    openProfile() {
      if (!this.currentUser) return;
      if (this.els.usernameDisplay) this.els.usernameDisplay.textContent = this.currentUser.email.split('@')[0];
      if (this.els.emailDisplay) this.els.emailDisplay.textContent = this.currentUser.email;
      if (this.els.simCount) this.els.simCount.textContent = this.currentUser.history.length;
      if (!this.currentUser.history) {
        this.currentUser.history = [];
      }

      const grades = this.currentUser.history.map(h => h.grade);
      if (this.els.bestGrade) {
        this.els.bestGrade.textContent = grades.includes('A') ? 'A' : (grades.includes('B') ? 'B' : (grades.length ? grades[0] : '--'));
      }

      this.renderHistory();
      if (this.els.profileMenu) this.els.profileMenu.classList.remove('hidden');
    }

    renderHistory() {
      if (!this.els.historyList) return;
      this.els.historyList.innerHTML = '';
      if (this.currentUser.history.length === 0) {
        this.els.historyList.innerHTML = '<p class="empty-msg">Noch keine Auswertungen vorhanden.</p>';
        return;
      }

      // We slice() to get a copy, then reverse for display, but we need the real index for deletion
      const indexedHistory = this.currentUser.history.map((item, index) => ({ item, index }));

      indexedHistory.reverse().forEach(entry => {
        const item = entry.item;
        const index = entry.index;
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <span class="h-date">${item.date}</span>
          <span class="h-grade grade-${item.grade.toLowerCase()}">${item.grade}</span>
          <span class="h-score">${item.tir}% TiR</span>
          <button class="h-delete-btn" title="Löschen">🗑️</button>
        `;

        div.querySelector('.h-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteResult(index);
        });

        this.els.historyList.appendChild(div);
      });
    }

    deleteResult(index) {
      if (!this.currentUser) return;
      if (confirm("Möchtest du diese Auswertung wirklich löschen?")) {
        this.currentUser.history.splice(index, 1);
        this.saveCurrentUserChange();
        this.openProfile(); // Re-render everything
        sounds.play('click');
      }
    }

    clearHistory() {
      if (!this.currentUser) return;
      if (confirm("Möchtest du ALLES löschen? Das kann nicht rückgängig gemacht werden.")) {
        this.currentUser.history = [];
        this.saveCurrentUserChange();
        this.openProfile();
        sounds.play('click');
      }
    }

    async saveResult(stats) {
      if (!this.currentUser) return;

      const entry = {
        date: new Date().toLocaleString(),
        grade: stats.grade,
        tir: stats.tir,
        hypos: stats.hypos,
        hypers: stats.hypers
      };

      await fetch(`${API_BASE}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.currentUser._id,
          entry
        })
      });
    }

    updateStatusUI() {
      if (this.currentUser) {
        if (this.els.namePreview) this.els.namePreview.textContent = this.currentUser.email.split('@')[0];
        if (this.els.achCountPreview) {
          const earned = (this.currentUser.achievements || []).length;
          this.els.achCountPreview.textContent = `${earned}/${this.achievements.length}`;
        }
      } else {
        if (this.els.namePreview) this.els.namePreview.textContent = "Nicht angemeldet";
        if (this.els.achCountPreview) this.els.achCountPreview.textContent = "--";
      }
    }

    closeAll() {
      if (this.els.authMenu) this.els.authMenu.classList.add('hidden');
      if (this.els.profileMenu) this.els.profileMenu.classList.add('hidden');
    }
  }

  // --- Main Engine ---
  class Simulation {
    constructor() {
      this.bg = 100;
      this.metabolismRate = 0; // Set by selection
      this.time = { h: 8, m: 0 };
      this.totalMinutes = 0;
      this.activeBoluses = [];
      this.activeMeals = [];
      this.activeActivities = [];
      this.history = []; // { t: "08:00", bg: 100 }

      this.tracker = new DayTracker();
      this.isDead = false;
      this.autoRunInterval = null;
      this.autoRunSpeed = 100;

      this.daysSurvived = 0;
      this.activityCount = 0;

      this.initChart();
      this.updateUI();
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
      this.tracker.reset();

      // Clear Overlays
      const deathOverlay = document.getElementById('deathOverlay');
      const resultsOverlay = document.getElementById('resultsOverlay');
      if (deathOverlay) deathOverlay.classList.add('hidden');
      if (resultsOverlay) resultsOverlay.classList.add('hidden');

      // Reset Chart
      if (this.chart) {
        this.chart.data.labels = ["08:00"];
        this.chart.data.datasets[0].data = [100];
        this.chart.options.scales.y.max = 200;
        this.chart.update('none');
      }

      this.updateUI();
    }

    startStoryLevel(level) {
      this.fullReset();
      this.currentStoryLevel = parseInt(level, 10);
      this.metabolismRate = 15; // default rate
      this.updateUI();
    }

    // Time Management
    tick(minutes) {
      if (this.isDead) return;

      // 1. Apply Metabolism
      const rate = parseFloat(this.metabolismRate);
      const metabolismEffect = (isNaN(rate) ? 0 : rate / 60) * minutes;
      this.bg += metabolismEffect;

      // 2. Apply Insulin (InsulinEffect)
      let drop = 0;
      this.activeBoluses.forEach(b => drop += b.getEffect(minutes));
      this.bg -= drop;

      // 3. Apply Meals (MealEffect)
      let rise = 0;
      this.activeMeals.forEach(m => rise += m.getEffect(minutes));
      this.bg += rise;

      // 4. Apply Activities
      let sportDrop = 0;
      const currentIOB = parseFloat(this.getIOB());
      this.activeActivities.forEach(a => sportDrop += a.getEffect(minutes, currentIOB));
      this.bg -= sportDrop;

      // 5. Random Events
      this.processRandomEvents();

      // 6. Cleanup expired
      this.activeBoluses = this.activeBoluses.filter(b => b.elapsed < b.duration);
      this.activeMeals = this.activeMeals.filter(m => m.elapsed < m.duration);
      this.activeActivities = this.activeActivities.filter(a => a.elapsed < a.duration);

      // 7. Check Health & Track Stats
      this.checkHealth();
      this.tracker.track(this.bg);

      // 8. Advance Time
      this.time.m += minutes;
      this.totalMinutes += minutes;
      if (this.time.m >= 60) {
        this.time.h += Math.floor(this.time.m / 60);
        this.time.m %= 60;
      }
      if (this.time.h >= 24) this.time.h %= 24;

      // 9. Day Summary
      if (this.totalMinutes >= 1440) { // 24 Hours
        this.showDaySummary();
        this.totalMinutes = 0; // Reset for next day
        this.tracker.reset();
      }

      // 10. Record History
      this.history.push({
        x: this.formatTime(),
        y: Math.round(this.bg)
      });

      if (this.history.length > 288) this.history.shift();
    }

    processRandomEvents() {
      CONFIG.EVENTS.forEach(ev => {
        if (Math.random() < ev.probability) {
          const effect = parseFloat(ev.effect);
          if (!isNaN(effect)) {
            this.bg += effect;
            this.showNotification(ev.msg);
          }
        }
      });
    }

    showNotification(msg) {
      const el = document.getElementById('eventNotification');
      const msgEl = document.getElementById('eventMessage');
      if (el && msgEl) {
        msgEl.textContent = msg;
        el.classList.remove('hidden');

        // Hide after 5 seconds
        if (this.notifTimeout) clearTimeout(this.notifTimeout);
        this.notifTimeout = setTimeout(() => {
          el.classList.add('hidden');
        }, 5000);
      }
    }

    checkHealth() {
      if (isNaN(this.bg)) this.bg = 100;
      if (this.bg <= CONFIG.DEATH_LOW) {
        this.die(`Hypoglykämischer Schock! (Blutzucker < ${CONFIG.DEATH_LOW})`);
      } else if (this.bg >= CONFIG.DEATH_HIGH) {
        this.die(`Ketoazidotisches Koma! (Blutzucker > ${CONFIG.DEATH_HIGH})`);
      }
      else if (this.bg <= CONFIG.WARN_LOW) {
        this.warn("Niedriger Blutzucker! 🍎");
      } else if (this.bg >= CONFIG.WARN_HIGH) {
        this.warn("Hoher Blutzucker! 💉");
      }
    }

    warn(message) {
      const statusEl = document.getElementById('healthStatus');
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = "health-status warning warning-pulse";
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
      const overlay = document.getElementById('deathOverlay');
      if (overlay) overlay.classList.add('hidden');
      this.updateUI();
    }

    // HUD & Internal tracking
    getIOB() {
      const val = this.activeBoluses.reduce((acc, b) => acc + (b.amount || 0), 0);
      return isNaN(val) ? "0.0" : val.toFixed(1);
    }

    getCOB() {
      const val = this.activeMeals.reduce((acc, m) => acc + (m.carbs || 0), 0);
      return isNaN(val) ? "0" : val.toFixed(0);
    }

    addInsulin(units, type = 'BOLUS') {
      if (units <= 0 || isNaN(units) || this.isDead) return;
      this.activeBoluses.push(new InsulinEffect(units, type));
    }

    addCarbs(grams, type = 'NORMAL') {
      if (grams <= 0 || isNaN(grams) || this.isDead) return;
      this.activeMeals.push(new MealEffect(grams, type));
    }

    addActivity(type) {
      if (this.isDead) return;
      this.activeActivities.push(new SportEffect(type));
      this.activityCount++;
      if (this.auth && this.activityCount >= 5) {
        this.auth.unlockAchievement('sporty');
      }
    }

    showDaySummary() {
      const stats = this.tracker.getScore();
      this.stopAutoRun();

      this.daysSurvived++;
      if (this.auth) {
        this.auth.saveResult(stats);
        this.auth.unlockAchievement('survive_day');
        if (stats.tir === 100) this.auth.unlockAchievement('perfect_tir');
        if (stats.grade === 'A') this.auth.unlockAchievement('grade_a');
      }

      const overlay = document.getElementById('resultsOverlay');
      if (overlay) {
        document.getElementById('resTIR').textContent = stats.tir + "%";
        document.getElementById('resHypos').textContent = stats.hypos;
        document.getElementById('resHypers').textContent = stats.hypers;

        const gradeEl = document.getElementById('resGrade');
        if (gradeEl) {
          gradeEl.textContent = stats.grade;
          // Remove old classes
          gradeEl.classList.remove('grade-a', 'grade-b', 'grade-c', 'grade-d', 'grade-f');
          // Add new class
          gradeEl.classList.add(`grade-${stats.grade.toLowerCase()}`);
        }

        overlay.classList.remove('hidden');
      }
    }



    run(hours) {
      if (this.isDead) return;
      const steps = (hours * 60) / CONFIG.TIME_STEP;
      for (let i = 0; i < steps; i++) {
        this.tick(CONFIG.TIME_STEP);
        if (this.isDead) break;
      }
      this.updateUI();
    }

    toggleAutoRun() {
      if (this.autoRunInterval) {
        this.stopAutoRun();
      } else {
        this.startAutoRun();
      }
    }

    startAutoRun() {
      if (this.isDead) return;
      const btn = document.getElementById('autoRunBtn');
      if (btn) {
        btn.innerHTML = "⏸ Stop";
        btn.classList.add('danger');
      }

      this.autoRunInterval = setInterval(() => {
        this.tick(CONFIG.TIME_STEP);
        this.updateUI();
        if (this.isDead) this.stopAutoRun();
      }, this.autoRunSpeed);
    }

    stopAutoRun() {
      clearInterval(this.autoRunInterval);
      this.autoRunInterval = null;
      const btn = document.getElementById('autoRunBtn');
      if (btn) {
        btn.innerHTML = "▶ Run";
        btn.classList.remove('danger');
      }
    }

    setSpeed(ms) {
      this.autoRunSpeed = ms;
      if (this.autoRunInterval) {
        this.stopAutoRun();
        this.startAutoRun();
      }
    }

    // UI Helpers
    formatTime() {
      return `${String(this.time.h).padStart(2, '0')}:${String(this.time.m).padStart(2, '0')}`;
    }

    updateUI() {
      // Update Text
      const timeEl = document.getElementById('timeDisplay');
      if (timeEl) timeEl.textContent = this.formatTime();

      const bgEl = document.getElementById('bgDisplay');
      const statusEl = document.getElementById('healthStatus');
      const dashboard = document.querySelector('.dashboard-container');

      // Default State
      let statusText = "STATUS: OK";
      let statusClass = "health-status";
      if (dashboard) {
        dashboard.classList.remove('state-warning', 'state-critical');
      }

      const val = Math.round(this.bg);
      if (bgEl && !isNaN(val)) {
        bgEl.textContent = val;

        if (val < CONFIG.DEATH_LOW || val >= CONFIG.DEATH_HIGH) {
          statusText = val < CONFIG.DEATH_LOW ? "KRITISCH (HYPO)" : "KRITISCH (HYPER)";
          statusClass += " critical";
          bgEl.style.color = 'var(--danger-color)';
          if (dashboard) dashboard.classList.add('state-critical');
        } else if (val < CONFIG.WARN_LOW || val > CONFIG.WARN_HIGH) {
          statusText = val < CONFIG.WARN_LOW ? "NIEDRIG (WARN)" : "HOCH (WARN)";
          statusClass += " warning";
          bgEl.style.color = 'var(--warn-color)';
          if (dashboard) dashboard.classList.add('state-warning');
        } else {
          statusText = "STATUS: OK";
          bgEl.style.color = 'var(--accent-color)';
        }

        if (statusEl) {
          statusEl.textContent = statusText;
          statusEl.className = statusClass;
        }
      }

      const iobEl = document.getElementById('iobDisplay');
      if (iobEl) iobEl.textContent = this.getIOB();

      const cobEl = document.getElementById('cobDisplay');
      if (cobEl) cobEl.textContent = this.getCOB();

      // Update Chart
      if (this.chart && this.history.length > 0) {
        this.chart.data.labels = this.history.map(h => h.x);
        this.chart.data.datasets[0].data = this.history.map(h => h.y);

        // Safety check for maxVal calculation
        const historyValues = this.history.map(h => h.y).filter(v => !isNaN(v));
        const maxVal = historyValues.length > 0 ? Math.max(val, ...historyValues) : 200;

        let newMax = 200;
        if (maxVal > 580) newMax = Math.ceil((maxVal + 50) / 50) * 50;
        else if (maxVal > 380) newMax = 600;
        else if (maxVal > 180) newMax = 400;
        else newMax = 200;

        if (!isNaN(newMax) && this.chart.options.scales.y.max !== newMax) {
          this.chart.options.scales.y.max = newMax;
        }

        // Dynamic Chart Colors
        const ds = this.chart.data.datasets[0];
        if (val < CONFIG.DEATH_LOW || val >= CONFIG.DEATH_HIGH) {
          ds.borderColor = '#d50000';
          ds.backgroundColor = 'rgba(213, 0, 0, 0.2)';
        } else if (val < CONFIG.WARN_LOW || val > CONFIG.WARN_HIGH) {
          ds.borderColor = '#ff6d00';
          ds.backgroundColor = 'rgba(255, 109, 0, 0.2)';
        } else {
          ds.borderColor = '#00c853';
          ds.backgroundColor = 'rgba(0, 200, 83, 0.2)';
        }

        this.chart.update('none');
      }
    }

    initChart() {
      const canvas = document.getElementById('bgChart');
      if (!canvas) {
        console.warn("Chart canvas element not found.");
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn("Could not get 2D context for chart.");
        return;
      }

      // Initial Data
      if (this.history.length === 0) {
        this.history.push({ x: this.formatTime(), y: this.bg });
      }

      if (typeof Chart === 'undefined') {
        console.error("Chart.js is not loaded. Retrying in 1s...");
        setTimeout(() => this.initChart(), 1000);
        return;
      }

      const annotationPlugin = window['chartjs-plugin-annotation'];
      const plugins = { legend: { display: false } };

      if (annotationPlugin) {
        plugins.annotation = {
          annotations: {
            low: {
              type: 'line',
              yMin: 70,
              yMax: 70,
              borderColor: 'rgba(255, 23, 68, 0.5)',
              borderWidth: 1,
              borderDash: [5, 5],
              label: { content: 'Low', enabled: true, color: 'red', position: 'start' }
            },
            high: {
              type: 'line',
              yMin: 180,
              yMax: 180,
              borderColor: 'rgba(255, 145, 0, 0.5)',
              borderWidth: 1,
              borderDash: [5, 5],
              label: { content: 'High', enabled: true, color: 'orange', position: 'start' }
            },
            deadLow: {
              type: 'box',
              yMin: 0,
              yMax: 30,
              backgroundColor: 'rgba(255, 23, 68, 0.2)',
              borderWidth: 0
            },
            deadHigh: {
              type: 'box',
              yMin: 600,
              yMax: 1000,
              backgroundColor: 'rgba(255, 23, 68, 0.2)',
              borderWidth: 0
            }
          }
        };
      }

      try {
        if (this.chart) this.chart.destroy();
        this.chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: this.history.map(h => h.x),
            datasets: [{
              label: 'Blutzucker (mg/dL)',
              data: this.history.map(h => h.y),
              borderColor: '#00c853',
              backgroundColor: 'rgba(0, 200, 83, 0.2)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              pointRadius: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: {
                min: 0,
                max: 400,
                grid: { color: 'rgba(0,0,0,0.05)' },
                ticks: { color: '#666' },
              },
              x: {
                grid: { color: 'rgba(0,0,0,0.05)' },
                ticks: { color: '#666', maxTicksLimit: 8 }
              }
            },
            plugins: plugins
          }
        });
      } catch (err) {
        console.error("Failed to initialize Chart:", err);
      }
    }

    updateChartTheme(isDark) {
      if (!this.chart) return;

      const textColor = isDark ? '#e0e0e0' : '#444';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';

      if (this.chart.options.scales.x) {
        this.chart.options.scales.x.ticks.color = textColor;
        this.chart.options.scales.x.grid.color = gridColor;
      }
      if (this.chart.options.scales.y) {
        this.chart.options.scales.y.ticks.color = textColor;
        this.chart.options.scales.y.grid.color = gridColor;
      }

      // Update Chart defaults for future updates? Not strictly needed if we update instance options
      this.chart.update('none');
    }
  }

  // --- App Initialization ---
  document.addEventListener('DOMContentLoaded', () => {
    const sim = new Simulation();
    const auth = new AuthManager(sim);
    sim.auth = auth;

    // --- Navigation UI Elements ---
    const mainMenu = document.getElementById('mainMenu');
    const modeSelection = document.getElementById('modeSelection');
    const dashboard = document.querySelector('.dashboard-container');
    const bodyTypeDisplay = document.getElementById('bodyTypeDisplay');

    const startGameBtn = document.getElementById('startGameBtn');
    if (startGameBtn) {
      startGameBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mainMenuCard = document.getElementById('mainMenuCard');
        if (mainMenuCard) mainMenuCard.classList.add('hidden');
        const modeSelection = document.getElementById('modeSelection');
        if (modeSelection) modeSelection.classList.remove('hidden');
      });
    }

    const backToMainFromMode = document.getElementById('backToMainFromMode');
    if (backToMainFromMode) {
      backToMainFromMode.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modeSelection = document.getElementById('modeSelection');
        if (modeSelection) modeSelection.classList.add('hidden');
        const mainMenuCard = document.getElementById('mainMenuCard');
        if (mainMenuCard) mainMenuCard.classList.remove('hidden');
      });
    }

    const startArcade = document.getElementById('startArcade');
    if (startArcade) {
      startArcade.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = 'arcade.html';
      });
    }

    const startStory = document.getElementById('startStory');
    const storySelection = document.getElementById('storySelection');
    if (startStory) {
      startStory.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modeSelection = document.getElementById('modeSelection');
        if (modeSelection) modeSelection.classList.add('hidden');
        if (storySelection) storySelection.classList.remove('hidden');
      });
    }

    const backToModeFromStory = document.getElementById('backToModeFromStory');
    if (backToModeFromStory) {
      backToModeFromStory.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (storySelection) storySelection.classList.add('hidden');
        const modeSelection = document.getElementById('modeSelection');
        if (modeSelection) modeSelection.classList.remove('hidden');
      });
    }

    // --- Start Screen Logic (Character Selection) ---
    const typeButtons = document.querySelectorAll('.body-type-btn');

    typeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const customParams = document.getElementById('customParams');

        if (type === 'custom') {
          customParams.classList.remove('hidden');
          // Deselect others visually if needed, but simple toggle is fine
          return;
        }

        customParams.classList.add('hidden');
        const rate = parseFloat(btn.dataset.rate);
        sim.metabolismRate = rate;
        const typeName = btn.querySelector('.label').textContent;
        const icon = btn.querySelector('.icon').textContent;

        startGame(typeName, icon, rate);
      });
    });

    const startCustomBtn = document.getElementById('startCustomBtn');
    if (startCustomBtn) {
      startCustomBtn.addEventListener('click', () => {
        const rate = parseFloat(document.getElementById('customRate').value);
        const isf = parseFloat(document.getElementById('customISF').value);
        const icr = parseFloat(document.getElementById('customICR').value);

        if (!isNaN(isf)) CONFIG.ISF = isf;
        if (!isNaN(icr)) CONFIG.ICR = icr;
        sim.metabolismRate = rate;

        startGame("Benutzerdefiniert", "⚙️", rate);
      });
    }

    function startGame(typeName, icon, rate) {
      // Hide all overlays
      const overlays = document.querySelectorAll('.start-overlay');
      overlays.forEach(o => o.classList.add('hidden'));
      dashboard.classList.remove('blur-background');

      // Update Header Display
      if (bodyTypeDisplay) {
        bodyTypeDisplay.querySelector('.icon').textContent = icon;
        bodyTypeDisplay.querySelector('.text').textContent = typeName;
      }

      // Log selection (if log existed, otherwise just console or nothing)
      // sim.log(`Simulation gestartet. Körpertyp: ${typeName} (${rate > 0 ? '+' : ''}${rate} mg/dL/h)`);
    }

    // --- Story Mode Logic ---
    const storyButtons = document.querySelectorAll('.story-lvl-btn');
    storyButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const level = btn.dataset.level;
        if (typeof sim.startStoryLevel === 'function') {
          sim.startStoryLevel(level);
        }

        // Hide start overlays and show dashboard
        const overlays = document.querySelectorAll('.start-overlay');
        overlays.forEach(o => o.classList.add('hidden'));
        dashboard.classList.remove('hidden');
        dashboard.classList.remove('blur-background');

        const storySelection = document.getElementById('storySelection');
        if (storySelection) storySelection.classList.add('hidden');

        const mainMenu = document.getElementById('mainMenu');
        if (mainMenu) mainMenu.classList.add('hidden'); // explicitly hide fully

        if (bodyTypeDisplay) {
          bodyTypeDisplay.querySelector('.icon').textContent = "📖";
          bodyTypeDisplay.querySelector('.text').textContent = `Story Level ${level}`;
        }
      });
    });

    // --- Collapsible Cards Logic (Accordion) ---
    const collapsibles = document.querySelectorAll('.collapsible-card');
    collapsibles.forEach(card => {
      const toggle = card.querySelector('.collapse-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const isCollapsed = card.classList.contains('collapsed');

          // Close all others
          collapsibles.forEach(c => c.classList.add('collapsed'));

          // Toggle current
          if (isCollapsed) {
            card.classList.remove('collapsed');
          }
        });
      }
    });

    // Start with all collapsed except the first one for a cleaner look
    collapsibles.forEach((c, idx) => {
      if (idx !== 0) c.classList.add('collapsed');
    });

    // --- Settings UI Elements ---
    const settingsMenu = document.getElementById('settingsMenu');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const masterVolume = document.getElementById('masterVolume');
    const sfxVolume = document.getElementById('sfxVolume');
    const masterVolumeValue = document.getElementById('masterVolumeValue');
    const sfxVolumeValue = document.getElementById('sfxVolumeValue');

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        settingsMenu.classList.remove('hidden');
      });
    }

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
        sounds.play('click');
      });
    }

    if (masterVolume) {
      masterVolume.addEventListener('input', (e) => {
        const val = e.target.value;
        masterVolumeValue.textContent = val + "%";
        sounds.setMasterVolume(val);
      });
    }

    if (sfxVolume) {
      sfxVolume.addEventListener('input', (e) => {
        const val = e.target.value;
        sfxVolumeValue.textContent = val + "%";
        sounds.setSfxVolume(val);
      });
    }

    // --- Theme Logic ---
    const themeBtn = document.getElementById('themeToggle');
    const body = document.body;

    // Check local storage 
    let isDark = localStorage.getItem('theme') === 'dark';
    if (isDark) {
      body.classList.add('dark-mode');
      sim.updateChartTheme(true);
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        isDark = !isDark;
        if (isDark) {
          body.classList.add('dark-mode');
          localStorage.setItem('theme', 'dark');
        } else {
          body.classList.remove('dark-mode');
          localStorage.setItem('theme', 'light');
        }
        sim.updateChartTheme(isDark);
        sounds.play('click');
      });
    }

    // --- Action Button Listeners ---
    const mealButtons = document.querySelectorAll('.meal-btn');
    mealButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetEffect = parseFloat(btn.dataset.carbs); // used as effect target
        const type = btn.dataset.type;
        // Calculation: 10g carbs raises BG by (ISF/ICR) mg/dL
        // Amount (g) = (targetEffect * ICR) / ISF
        const carbs = (targetEffect * CONFIG.ICR) / CONFIG.ISF;
        sim.addCarbs(carbs, type);
        sim.updateUI();
      });
    });

    const insulinButtons = document.querySelectorAll('.insulin-btn:not(.correction)');
    insulinButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetEffect = parseFloat(btn.dataset.effect);
        const type = btn.dataset.type;
        // Calculation: 1 Unit drops BG by ISF mg/dL
        // Amount (Units) = targetEffect / ISF
        const units = targetEffect / CONFIG.ISF;
        sim.addInsulin(units, type);
        sim.updateUI();
      });
    });

    const correctionBtn = document.getElementById('correctionBtn');
    if (correctionBtn) {
      correctionBtn.addEventListener('click', () => {
        const currentBG = sim.bg;
        const targetBG = CONFIG.TARGET_BG;
        if (currentBG > targetBG) {
          const diff = currentBG - targetBG;
          // Constrain diff to 40-80 as requested roughly, but let's just calculate exact
          // User said "Korrektur-Dosis (-40 bis -80 mg/dL je nach Wert)"
          const targetDrop = Math.min(Math.max(diff, 40), 80);
          const units = targetDrop / CONFIG.ISF;
          sim.addInsulin(units, 'BOLUS');
          sim.updateUI();
        }
      });
    }

    const sportButtons = document.querySelectorAll('.sport-btn');
    sportButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        sim.addActivity(type);
        sim.updateUI();
      });
    });

    // --- Simulation Controls ---
    const nextHourBtn = document.getElementById('nextHourBtn');
    if (nextHourBtn) {
      nextHourBtn.addEventListener('click', () => {
        sim.run(1); // 1 hour
      });
    }

    const autoRunBtn = document.getElementById('autoRunBtn');
    if (autoRunBtn) {
      autoRunBtn.addEventListener('click', () => {
        sim.toggleAutoRun();
      });
    }

    const speedSlider = document.getElementById('speedSlider');
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        const ms = 600 - val;
        sim.setSpeed(ms);
      });
    }

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        sim.fullReset();
      });
    }

    const respawnBtn = document.getElementById('respawnBtn');
    if (respawnBtn) {
      respawnBtn.addEventListener('click', () => {
        sim.fullReset();
      });
    }

    // Also handle the reset button in the results overlay
    const resultsResetBtn = document.querySelector('#resultsOverlay .restart-btn');
    if (resultsResetBtn) {
      resultsResetBtn.addEventListener('click', () => {
        sim.fullReset();
      });
    }

    const reviveBtn = document.getElementById('reviveBtn');
    if (reviveBtn) {
      reviveBtn.addEventListener('click', () => {
        sim.revive();
      });
    }

    const headerTitle = document.getElementById('headerTitle');
    if (headerTitle) {
      headerTitle.addEventListener('click', () => {
        sim.stopAutoRun();
        dashboard.classList.add('hidden');
        mainMenu.classList.remove('hidden');
        // Ensure startScreen is hidden too if it was visible
        startScreen.classList.add('hidden');
      });
    }
  });
})();
