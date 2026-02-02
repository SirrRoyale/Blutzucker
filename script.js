// ===== BASIS =====
let blutzucker = 90;
let hour = 6;
let day = 1;

const timeSpan = document.getElementById("time");
const daySpan = document.getElementById("day");
const valueSpan = document.getElementById("value");


// ===== CHART =====
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");

const data = {
  labels: ["06:00"],
  datasets: [{
    label: "Blutzucker (mg/dL)",
    data: [blutzucker],
    borderWidth: 4,
    tension: 0.35
  }]
};

const chart = new Chart(ctx, {
  type: "line",
  data: data,
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 50,
        max: 350,
        title: {
          display: true,
          text: "Blutzucker (mg/dL)"
        }
      },
      x: {
        title: {
          display: true,
          text: "Uhrzeit"
        }
      }
    }
  }
});

// ===== HILFSFUNKTIONEN =====
function updateTime() {
  timeSpan.textContent = String(hour).padStart(2, "0") + ":00";
  daySpan.textContent = "Tag " + day;
}


function regulation() {
  if (blutzucker > 110) blutzucker -= 10; // Insulin
  if (blutzucker < 70) blutzucker += 10;  // Glucagon
}

// ===== ZEIT =====
function nextHour() {
  hour++;

  if (hour === 24) {
    hour = 0;
    day++;
  }

  regulation();

  updateTime();
  valueSpan.textContent = Math.round(blutzucker);

  data.labels.push(`Tag ${day} ${String(hour).padStart(2, "0")}:00`);
  data.datasets[0].data.push(blutzucker);
  chart.update();
}


// ===== BUTTONS =====
function zucker() {
  blutzucker += 30;
  valueSpan.textContent = blutzucker;
}

function mahlzeit() {
  blutzucker += 20;
  valueSpan.textContent = blutzucker;
}

function sport() {
  blutzucker -= 25;
  valueSpan.textContent = blutzucker;
}

function reset() {
  blutzucker = 90;
  hour = 6;
  day = 1;

  data.labels.length = 1;
  data.datasets[0].data.length = 1;
  data.datasets[0].data[0] = blutzucker;

  updateTime();
  valueSpan.textContent = blutzucker;
  chart.update();
}

