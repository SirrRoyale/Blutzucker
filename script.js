// ===== ZEIT =====
let hour = 6;
let day = 1;

// ===== BLUTZUCKER =====
let blutzucker = 90;

// ===== HORMONE =====
let insulin = 0;
let glucagon = 0;
const MIN_GLUCOSE = 30;
const MAX_GLUCOSE = 600;


// ===== DOM =====
const timeSpan = document.getElementById("time");
const daySpan = document.getElementById("day");
const valueSpan = document.getElementById("value");
const insulinBar = document.getElementById("insulinBar");
const glucagonBar = document.getElementById("glucagonBar");



// ===== CHART =====
const ctx = document.getElementById("chart").getContext("2d");

const data = {
  labels: ["06:00"],
  datasets: [{
    label: "Blutzucker (mg/dL)",
    data: [blutzucker],
    borderWidth: 3,
    tension: 0.3
  }]
};

const chart = new Chart(ctx, {
  type: "line",
  data: data,
  options: {
    scales: {
      y: {
        min: 50,
        max: 250
      }
    }
  }
});

// ===== FUNKTIONEN =====

// Anzeige aktualisieren
function updateTime() {
  timeSpan.textContent = String(hour).padStart(2, "0") + ":00";
  daySpan.textContent = "Tag " + day;
  valueSpan.textContent = Math.round(blutzucker);
}

// 🍬 Zucker
function zucker() {
  blutzucker += 30;
  insulin += 15;
  updateHormoneBars();
  clampGlucose();
  checkCriticalState();

}

// 🍽️ Mahlzeit
function mahlzeit() {
  blutzucker += 20;
  insulin += 10;
  updateHormoneBars();
  clampGlucose();
  checkCriticalState();

}

// 🏃 Sport
function sport() {
  blutzucker -= 25;
  glucagon += 15;
  updateHormoneBars();
  clampGlucose();
  checkCriticalState();

}

// 🧪 Hormonwirkung (pro Stunde)
function hormoneRegulation() {
  // Insulin senkt Blutzucker
  if (insulin > 0) {
    blutzucker -= insulin * 0.2;
    insulin -= 3;
    updateHormoneBars();
    clampGlucose();
    checkCriticalState();

  }

  // Glucagon erhöht Blutzucker
  if (glucagon > 0) {
    blutzucker += glucagon * 0.2;
    glucagon -= 3;
  }

  insulin = Math.max(insulin, 0);
  glucagon = Math.max(glucagon, 0);
}

// ⏩ +1 Stunde
function nextHour() {
  hour++;
  if (hour === 24) {
    hour = 0;
    day++;
  }

  hormoneRegulation();
  updateTime();
  clampGlucose();
  checkCriticalState();


  data.labels.push(`Tag ${day} ${String(hour).padStart(2, "0")}:00`);
  data.datasets[0].data.push(blutzucker);
  chart.update();
}

// 🔄 Reset
function reset() {
  hour = 6;
  day = 1;
  blutzucker = 90;
  insulin = 0;
  glucagon = 0;

  data.labels = ["06:00"];
  data.datasets[0].data = [blutzucker];
  chart.update();

  updateTime();
  updateHormoneBars();

}

updateTime();

function updateHormoneBars() {
  insulinBar.style.width = Math.min(insulin * 3, 100) + "%";
  glucagonBar.style.width = Math.min(glucagon * 3, 100) + "%";
}
function clampGlucose() {
  if (blutzucker < MIN_GLUCOSE) blutzucker = MIN_GLUCOSE;
  if (blutzucker > MAX_GLUCOSE) blutzucker = MAX_GLUCOSE;
}
function checkCriticalState() {
  if (blutzucker <= 40) {
    alert("Kritische Unterzuckerung! Bewusstlosigkeit moeglich.");
  }
  if (blutzucker >= 400) {
    alert("Kritische Ueberzuckerung! Akute Gefahr.");
  }
}
