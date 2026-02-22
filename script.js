
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
    }

    showDaySummary() {
      const stats = this.tracker.getScore();
      this.stopAutoRun();

      const overlay = document.getElementById('resultsOverlay');
      if (overlay) {
        document.getElementById('resTIR').textContent = stats.tir + "%";
        document.getElementById('resHypos').textContent = stats.hypos;
        document.getElementById('resHypers').textContent = stats.hypers;
        document.getElementById('resGrade').textContent = stats.grade;
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
      const ctx = document.getElementById('bgChart').getContext('2d');

      // Initial Data
      this.history.push({ x: this.formatTime(), y: this.bg });

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

      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [this.formatTime()],
          datasets: [{
            label: 'Blutzucker (mg/dL)',
            data: [this.bg],
            borderColor: '#00c853', // Match new accent
            backgroundColor: 'rgba(0, 200, 83, 0.2)', // Slightly stronger fill
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false, // Disable default chart animations for performance
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              min: 0,
              max: 400, // Look above 400 allows seeing high spikes
              grid: { color: 'rgba(0,0,0,0.05)' }, // Light dark grid
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

    // --- Navigation UI Elements ---
    const mainMenu = document.getElementById('mainMenu');
    const startScreen = document.getElementById('startScreen');
    const dashboard = document.querySelector('.dashboard-container');
    const bodyTypeDisplay = document.getElementById('bodyTypeDisplay');

    const startGameBtn = document.getElementById('startGameBtn');
    if (startGameBtn) {
      startGameBtn.addEventListener('click', () => {
        mainMenu.classList.add('hidden');
        startScreen.classList.remove('hidden');
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
      // Hide overlays
      startScreen.classList.add('hidden');
      dashboard.classList.remove('blur-background');

      // Update Header Display
      if (bodyTypeDisplay) {
        bodyTypeDisplay.querySelector('.icon').textContent = icon;
        bodyTypeDisplay.querySelector('.text').textContent = typeName;
      }

      // Log selection (if log existed, otherwise just console or nothing)
      // sim.log(`Simulation gestartet. Körpertyp: ${typeName} (${rate > 0 ? '+' : ''}${rate} mg/dL/h)`);
    }

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
      });
    }

    // --- Action Button Listeners ---
    const eatBtn = document.getElementById('eatBtn');
    if (eatBtn) {
      eatBtn.addEventListener('click', () => {
        const carbs = parseFloat(document.getElementById('carbsInput').value);
        const type = document.getElementById('mealType').value;
        sim.addCarbs(carbs, type);
        sim.updateUI();
        // Reset input
        document.getElementById('carbsInput').value = 0;
      });
    }

    const injectBtn = document.getElementById('injectBtn');
    if (injectBtn) {
      injectBtn.addEventListener('click', () => {
        const units = parseFloat(document.getElementById('insulinInput').value);
        const type = document.getElementById('insulinType').value;
        sim.addInsulin(units, type);
        sim.updateUI();
        // Reset input
        document.getElementById('insulinInput').value = 0;
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
