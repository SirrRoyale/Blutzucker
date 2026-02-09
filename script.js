
(function () { // Wrap in IIFE to avoid global scope pollution
  // --- Constants & Config ---
  const CONFIG = {
    ISF: 40,        // Insulin Sensitivity Factor: 1 Unit drops BG by 40 mg/dL
    ICR: 10,        // Insulin-to-Carb Ratio: 1 Unit covers 10g Carbs
    BASAL: 0,       // Basal rate (Units/hr)
    METABOLISM: 10,  // Natural drop in BG per hour (mg/dL) - replaces LIVER_OUTPUT
    INSULIN_DURATION: 240, // 4 hours in minutes
    CARB_DURATION: 180,    // 3 hours in minutes
    GLUCAGON_DURATION: 90, // 1.5 hours in minutes
    GLUCAGON_RISE: 50,     // 1mg Glucagon raises BG by approx 50-100mg/dL
    TARGET_BG: 100,
    TIME_STEP: 5,   // Minutes per tick

    // Health Limits
    DEATH_LOW: 30,
    DEATH_HIGH: 600,
    WARN_LOW: 70,
    WARN_HIGH: 250
  };

  // --- Chart Global Defaults for Light Mode ---
  if (window.Chart) {
    Chart.defaults.color = '#444'; // Dark text
    Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.1)'; // Light borders
  }

  // --- Helper Classes ---

  class Bolus {
    constructor(amount) {
      this.initialAmount = amount;
      this.amount = amount;
      this.duration = CONFIG.INSULIN_DURATION;
      this.elapsed = 0;
    }

    getEffect(minutes) {
      if (this.elapsed >= this.duration) return 0;
      // Effect = Drop in BG
      const effect = (this.initialAmount * CONFIG.ISF) * (minutes / this.duration);
      this.elapsed += minutes;
      this.amount = Math.max(0, this.initialAmount * (1 - (this.elapsed / this.duration)));
      return effect;
    }
  }

  class Meal {
    constructor(carbs) {
      this.initialCarbs = carbs;
      this.carbs = carbs;
      this.duration = CONFIG.CARB_DURATION;
      this.elapsed = 0;
    }

    getEffect(minutes) {
      if (this.elapsed >= this.duration) return 0;
      const riseFactor = CONFIG.ISF / CONFIG.ICR;
      const totalRise = this.initialCarbs * riseFactor;
      const effect = totalRise * (minutes / this.duration);
      this.elapsed += minutes;
      this.carbs = Math.max(0, this.initialCarbs * (1 - (this.elapsed / this.duration)));
      return effect;
    }
  }

  class GlucagonShot {
    constructor() {
      // Standard dose, no variable amount for simplicity
      this.duration = CONFIG.GLUCAGON_DURATION;
      this.elapsed = 0;
      this.totalRise = 100; // Emergency shot raises BG significantly (e.g. 100mg/dL)
    }

    getEffect(minutes) {
      if (this.elapsed >= this.duration) return 0;
      // Non-linear absorption?? Let's stick to linear for consistency with others 
      // or maybe a bit faster? Uniform for now.
      const effect = this.totalRise * (minutes / this.duration);
      this.elapsed += minutes;
      return effect;
    }
  }

  // --- Main Engine ---

  class Simulation {
    constructor() {
      this.bg = 100;
      this.time = { h: 8, m: 0 };
      this.activeBoluses = [];
      this.activeMeals = [];
      this.activeGlucagon = [];
      this.history = []; // { t: "08:00", bg: 100 }

      this.isDead = false;
      this.autoRunInterval = null;
      this.autoRunSpeed = 100;

      this.initChart();
      this.updateUI();
    }

    // Time Management
    tick(minutes) {
      if (this.isDead) return;

      // 1. Apply Metabolism (Natural Drop)
      const metabolismEffect = (CONFIG.METABOLISM / 60) * minutes;
      this.bg -= metabolismEffect; // Drops over time

      // 2. Apply Boluses (Insulin drops BG)
      let drop = 0;
      this.activeBoluses.forEach(b => drop += b.getEffect(minutes));
      this.bg -= drop;

      // 3. Apply Meals (Carbs raise BG)
      let rise = 0;
      this.activeMeals.forEach(m => rise += m.getEffect(minutes));
      this.bg += rise;

      // 4. Apply Glucagon
      let gRise = 0;
      this.activeGlucagon.forEach(g => gRise += g.getEffect(minutes));
      this.bg += gRise;

      // 5. Cleanup expired
      this.activeBoluses = this.activeBoluses.filter(b => b.elapsed < b.duration);
      this.activeMeals = this.activeMeals.filter(m => m.elapsed < m.duration);
      this.activeGlucagon = this.activeGlucagon.filter(g => g.elapsed < g.duration);

      // 6. Check Health
      this.checkHealth();

      // 7. Advance Time
      this.time.m += minutes;
      if (this.time.m >= 60) {
        this.time.h += Math.floor(this.time.m / 60);
        this.time.m %= 60;
      }
      if (this.time.h >= 24) this.time.h %= 24;

      // 8. Record History
      this.history.push({
        x: this.formatTime(),
        y: Math.round(this.bg)
      });

      // Keep last 24h (288 * 5min = 1440 min)
      if (this.history.length > 288) this.history.shift();
    }

    checkHealth() {
      if (this.bg <= CONFIG.DEATH_LOW) {
        this.die("Hypoglykämischer Schock!");
      } else if (this.bg >= CONFIG.DEATH_HIGH) {
        this.die("Ketoazidotisches Koma!");
      } else if (this.bg <= CONFIG.WARN_LOW) {
        this.warn("Achtung: Blutzucker niedrig! Bitte essen! 🍎");
      } else {
        this.clearWarn();
      }
    }

    warn(message) {
      const overlay = document.getElementById('deathOverlay');
      const msg = document.getElementById('deathMessage');
      // Reuse overlay but style it as warning if not dead
      // Or better: Use a separate warning element or just show it in the UI status
      // For now, let's use a non-intrusive notification or update the health status prominently

      const statusEl = document.getElementById('healthStatus');
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = "health-status critical warning-pulse";
      }
    }

    clearWarn() {
      // Status is handled in updateUI usually, but strict warning clearing is good
    }

    die(reason) {
      this.isDead = true;
      this.stopAutoRun();

      const overlay = document.getElementById('deathOverlay');
      const msg = document.getElementById('deathMessage');
      if (overlay && msg) {
        msg.textContent = reason;
        overlay.classList.remove('hidden');
      }
    }

    revive() {
      this.isDead = false;
      this.bg = 100; // Reset to safe value
      this.activeBoluses = []; // Clear active insulin
      this.activeMeals = [];   // Clear active food
      this.activeGlucagon = []; // Clear active glucagon

      const overlay = document.getElementById('deathOverlay');
      if (overlay) {
        overlay.classList.add('hidden');
      }

      this.log("Wiederbelebt mit Lebenselixier! 🧪");
      this.updateUI();
    }

    addInsulin(units) {
      if (units <= 0 || this.isDead) return;
      this.activeBoluses.push(new Bolus(units));
      this.log(`Spritze: ${units} IE`);
    }

    addCarbs(grams) {
      if (grams <= 0 || this.isDead) return;
      this.activeMeals.push(new Meal(grams));
      this.log(`Essen: ${grams}g Kohlenhydrate`);
    }

    addGlucagon() {
      if (this.isDead) return;
      this.activeGlucagon.push(new GlucagonShot());
      this.log(`GLUKAGON NOTFALL-SPRITZE!`);
      this.updateUI();
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
        btn.textContent = "Stop Auto-Run";
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
        btn.textContent = "Auto-Run Starten";
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

    getIOB() {
      return this.activeBoluses.reduce((acc, b) => acc + b.amount, 0).toFixed(1);
    }

    getCOB() {
      return this.activeMeals.reduce((acc, m) => acc + m.carbs, 0).toFixed(0);
    }

    log(msg) {
      const logList = document.getElementById('eventLog');
      if (!logList) return;
      const li = document.createElement('li');
      li.innerHTML = `<span class="log-time">${this.formatTime()}</span> ${msg}`;
      logList.prepend(li); // Newest top
    }

    updateUI() {
      // Update Text
      const timeEl = document.getElementById('timeDisplay');
      if (timeEl) timeEl.textContent = this.formatTime();

      const bgEl = document.getElementById('bgDisplay');
      const statusEl = document.getElementById('healthStatus');

      if (bgEl) {
        const val = Math.round(this.bg);
        bgEl.textContent = val;

        // Color coding & Status
        let statusText = "OK";
        let statusClass = "health-status";

        if (val < CONFIG.DEATH_LOW || val > CONFIG.DEATH_HIGH) {
          statusText = "KRITISCH / TOD";
          statusClass += " critical";
          bgEl.style.color = 'var(--danger-color)';
        } else if (val < CONFIG.WARN_LOW) {
          statusText = "HYPO (NIEDRIG)";
          statusClass += " critical";
          bgEl.style.color = 'var(--danger-color)';
        } else if (val > CONFIG.WARN_HIGH) {
          statusText = "HYPER (HOCH)";
          statusClass += " warning";
          bgEl.style.color = 'var(--warn-color)';
        } else {
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
      if (this.chart) {
        this.chart.data.labels = this.history.map(h => h.x);
        this.chart.data.datasets[0].data = this.history.map(h => h.y);
        this.chart.update('none'); // 'none' mode for smoother animation in loop
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
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', () => {
    const sim = new Simulation();

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
    // Sliders sync with inputs
    function sync(id1, id2) {
      const el1 = document.getElementById(id1);
      const el2 = document.getElementById(id2);
      if (!el1 || !el2) return;

      el1.addEventListener('input', () => el2.value = el1.value);
      el2.addEventListener('input', () => el1.value = el2.value);
    }

    sync('carbsSlider', 'carbsInput');
    sync('insulinSlider', 'insulinInput');

    const eatBtn = document.getElementById('eatBtn');
    if (eatBtn) {
      eatBtn.addEventListener('click', () => {
        const carbs = parseFloat(document.getElementById('carbsInput').value);
        sim.addCarbs(carbs);
        sim.updateUI();
      });
    }

    const injectBtn = document.getElementById('injectBtn');
    if (injectBtn) {
      injectBtn.addEventListener('click', () => {
        const units = parseFloat(document.getElementById('insulinInput').value);
        sim.addInsulin(units);
        sim.updateUI();
      });
    }

    const glucagonBtn = document.getElementById('glucagonBtn');
    if (glucagonBtn) {
      glucagonBtn.addEventListener('click', () => {
        sim.addGlucagon();
      });
    }

    const nextHourBtn = document.getElementById('nextHourBtn');
    if (nextHourBtn) {
      nextHourBtn.addEventListener('click', () => {
        sim.run(1); // 1 hour
      });
    }

    // New Auto Run Logic overrides Old Logic
    const autoRunBtn = document.getElementById('autoRunBtn');
    if (autoRunBtn) {
      // Remove old event listener if possible (not needed here as we reload script)
      autoRunBtn.addEventListener('click', () => {
        sim.toggleAutoRun();
      });
    }

    const speedSlider = document.getElementById('speedSlider');
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        // Slider value: 10 (fast) to 500 (slow)
        // User probably wants Right = Fast? 
        // Standard UI: Right is "More" -> More Speed -> Lower Interval?
        // Let's assume Left=Slow (500ms), Right=Fast (10ms)
        // So ms = 510 - value
        const val = parseInt(e.target.value);
        const ms = 600 - val; // 600 - 500 = 100ms, 600 - 100 = 500ms
        sim.setSpeed(ms);
      });
    }

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }

    const respawnBtn = document.getElementById('respawnBtn');
    if (respawnBtn) {
      respawnBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }

    const reviveBtn = document.getElementById('reviveBtn');
    if (reviveBtn) {
      reviveBtn.addEventListener('click', () => {
        sim.revive();
      });
    }
  });
})();
