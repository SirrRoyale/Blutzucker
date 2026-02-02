// ===== BASIS =====
let blutzucker = 90;
let hour = 6;
let day = 1;

const timeSpan = document.getElementById("time");
const daySpan = document.getElementById("day");
const valueSpan = document.getElementById("value");

let energy = 0; // langfristiger Energieüberschuss
const avatar = document.getElementById("avatar");
const avatarText = document.getElementById("avatar-text");


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
  energy += 5;
  valueSpan.textContent = blutzucker;
  updateAvatar();
}

function mahlzeit() {
  blutzucker += 20;
  energy += 3;
  valueSpan.textContent = blutzucker;
  updateAvatar();
}

function sport() {
  blutzucker -= 25;
  energy -= 6;
  valueSpan.textContent = blutzucker;
  updateAvatar();
}


function reset() {
  blutzucker = 90;
  hour = 6;
  day = 1;
  energy = 0;

  data.labels.length = 1;
  data.datasets[0].data.length = 1;
  data.datasets[0].data[0] = blutzucker;

  updateTime();
  valueSpan.textContent = blutzucker;
  updateAvatar();
  chart.update();
}

function updateAvatar() {
  if (energy < -20) {
    avatar.className = "avatar slim";
    avatarText.textContent = "Untergewichtig";
  } 
  else if (energy < 20) {
    avatar.className = "avatar normal";
    avatarText.textContent = "Normalgewicht";
  } 
  else if (energy < 60) {
    avatar.className = "avatar heavy";
    avatarText.textContent = "Übergewicht";
  } 
  else {
    avatar.className = "avatar obese";
    avatarText.textContent = "Starkes Übergewicht";
  }
}
