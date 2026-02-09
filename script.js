
// --- Constants & Config ---
const CONFIG = {
  ISF: 40,        // Insulin Sensitivity Factor: 1 Unit drops BG by 40 mg/dL
  ICR: 10,        // Insulin-to-Carb Ratio: 1 Unit covers 10g Carbs
  BASAL: 0,       // Basal rate (Units/hr) - kept 0 for simplicity if using "Liver Output"
  LIVER_OUTPUT: 10, // Liver produces glucose raising BG by 10 mg/dL per hour (counteracts Basal)
  INSULIN_DURATION: 240, // 4 hours in minutes
  CARB_DURATION: 180,    // 3 hours in minutes
  TARGET_BG: 100,
  TIME_STEP: 5,   // Minutes per tick
};

// --- Helper Classes ---

class Bolus {
  constructor(amount) {
    this.initialAmount = amount;
    this.amount = amount;
    this.duration = CONFIG.INSULIN_DURATION;
    this.elapsed = 0;
  }

  // Returns the amount of insulin "active" (reducing BG) in this time step
  // Linear decay model: The 'power' is constant if we assume linear IOB decay?
  // Actually, "Activity" is the derivative of IOB.
  // If IOB decays linearly from 100% to 0% over 4 hours, the activity (rate of drop) is constant.
  // Rate = Total_Effect / Duration
  // Total Effect = Amount * ISF
  // Effect per minute = (Amount * ISF) / Duration
  getEffect(minutes) {
    if (this.elapsed >= this.duration) return 0;

    // This calculates how much IS_ACTIVE insulin is removed from the "stack" 
    // AND how much effect it has on BG.

    // Let's stick to the "Activity" model.
    // Drop in BG = (Amount * ISF) * (minutes / duration)
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

    // Rise in BG = (Carbs / ICR) * ISF ... Wait, that's deriving from Insulin.
    // Let's formulate: 10g carbs raises BG by how much?
    // If 1u (covers 10g) drops 40mg/dL, then 10g carbs raises 40mg/dL.
    // So Rise Factor = ISF / ICR (= 4 mg/dL per g)

    const riseFactor = CONFIG.ISF / CONFIG.ICR;
    const totalRise = this.initialCarbs * riseFactor;

    const effect = totalRise * (minutes / this.duration);

    this.elapsed += minutes;
    this.carbs = Math.max(0, this.initialCarbs * (1 - (this.elapsed / this.duration)));

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
    this.history = []; // { t: "08:00", bg: 100 }

    this.initChart();
    this.updateUI();
  }

  // Time Management
  tick(minutes) {
    // 1. Apply Basal / Liver
    // Net change if Basal = 0 and Liver = 10/hr is +10/hr
    // If we had basal, it would be: Liver - (Basal * ISF)
    const liverEffect = (CONFIG.LIVER_OUTPUT / 60) * minutes;
    this.bg += liverEffect;

    // 2. Apply Boluses (Insulin drops BG)
    let drop = 0;
    this.activeBoluses.forEach(b => drop += b.getEffect(minutes));
    this.bg -= drop;

    // 3. Apply Meals (Carbs raise BG)
    let rise = 0;
    this.activeMeals.forEach(m => rise += m.getEffect(minutes));
    this.bg += rise;

    // 4. Cleanup expired
    this.activeBoluses = this.activeBoluses.filter(b => b.elapsed < b.duration);
    this.activeMeals = this.activeMeals.filter(m => m.elapsed < m.duration);

    // 5. Advance Time
    this.time.m += minutes;
    if (this.time.m >= 60) {
      this.time.h += Math.floor(this.time.m / 60);
      this.time.m %= 60;
    }
    if (this.time.h >= 24) this.time.h %= 24;

    // 6. Record History
    this.history.push({
      x: this.formatTime(),
      y: Math.max(20, Math.round(this.bg)) // floor at 20 (coma)
    });

    if (this.history.length > 288) this.history.shift(); // Keep last 24h (288 * 5min)
  }

  addInsulin(units) {
    if (units <= 0) return;
    this.activeBoluses.push(new Bolus(units));
    this.log(`Spritze: ${units} IE`);
  }

  addCarbs(grams) {
    if (grams <= 0) return;
    this.activeMeals.push(new Meal(grams));
    this.log(`Essen: ${grams}g Kohlenhydrate`);
  }

  run(hours) {
    const steps = (hours * 60) / CONFIG.TIME_STEP;
    for (let i = 0; i < steps; i++) {
      this.tick(CONFIG.TIME_STEP);
    }
    this.updateUI();
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
    const li = document.createElement('li');
    li.innerHTML = `<span class="log-time">${this.formatTime()}</span> ${msg}`;
    logList.prepend(li); // Newest top
  }

  updateUI() {
    // Update Text
    document.getElementById('timeDisplay').textContent = this.formatTime();
    document.getElementById('bgDisplay').textContent = Math.round(this.bg);
    document.getElementById('iobDisplay').textContent = this.getIOB();
    document.getElementById('cobDisplay').textContent = this.getCOB();

    // Color coding
    const bgVal = document.getElementById('bgDisplay');
    if (this.bg < 70) bgVal.style.color = 'var(--danger-color)';
    else if (this.bg > 180) bgVal.style.color = 'var(--warn-color)';
    else bgVal.style.color = 'var(--accent-color)';

    // Update Chart
    this.chart.data.labels = this.history.map(h => h.x);
    this.chart.data.datasets[0].data = this.history.map(h => h.y);
    this.chart.update();
  }

  initChart() {
    const ctx = document.getElementById('bgChart').getContext('2d');

    // Initial Data
    this.history.push({ x: this.formatTime(), y: this.bg });

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [this.formatTime()],
        datasets: [{
          label: 'Blutzucker (mg/dL)',
          data: [this.bg],
          borderColor: '#00e676',
          backgroundColor: 'rgba(0, 230, 118, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 40,
            max: 350,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#aaa' },

          },
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#aaa', maxTicksLimit: 8 }
          }
        },
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              low: {
                type: 'line',
                yMin: 70,
                yMax: 70,
                borderColor: 'rgba(255, 23, 68, 0.5)',
                borderWidth: 1,
                borderDash: [5, 5],
                label: { content: 'Low', enabled: true, color: 'red' }
              },
              high: {
                type: 'line',
                yMin: 180,
                yMax: 180,
                borderColor: 'rgba(255, 145, 0, 0.5)',
                borderWidth: 1,
                borderDash: [5, 5]
              }
            }
          }
        }
      }
    });
  }
}

// --- App Initialization ---
const sim = new Simulation();

// --- Event Listeners ---

// Sliders sync with inputs
function sync(id1, id2) {
  const el1 = document.getElementById(id1);
  const el2 = document.getElementById(id2);
  el1.addEventListener('input', () => el2.value = el1.value);
  el2.addEventListener('input', () => el1.value = el2.value);
}

sync('carbsSlider', 'carbsInput');
sync('insulinSlider', 'insulinInput');

document.getElementById('eatBtn').addEventListener('click', () => {
  const carbs = parseFloat(document.getElementById('carbsInput').value);
  sim.addCarbs(carbs);
  sim.updateUI(); // Immediate UI update (stats), effect comes with ticks
});

document.getElementById('injectBtn').addEventListener('click', () => {
  const units = parseFloat(document.getElementById('insulinInput').value);
  sim.addInsulin(units);
  sim.updateUI();
});

document.getElementById('nextHourBtn').addEventListener('click', () => {
  sim.run(1); // 1 hour
});

document.getElementById('runDayBtn').addEventListener('click', () => {
  // Run until midnight? Or just 6 hours? Let's do 6 hours.
  sim.run(6);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  window.location.reload();
});
