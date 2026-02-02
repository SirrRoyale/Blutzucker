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

let maxDays = 10; // Standard
const HOURS_PER_DAY = 24;


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
  plugins: {
    legend: {
      labels: {
        color: "#ffffff",   
        font: { size: 14 }
      }
    }
  },
  scales: {
    y: {
      min: 50,
      max: 350,
      ticks: {
        color: "#ffffff"   
      },
      grid: {
        color: "rgba(255,255,255,0.1)"
      },
      title: {
        display: true,
        text: "Blutzucker (mg/dL)",
        color: "#ffffff"  
      }
    },
    x: {
  ticks: {
    color: "#ffffff",
    autoSkip: false,
    callback: function(value, index) {
      // Zeige NUR jede 24. Stunde (= neuer Tag)
      if (index % 24 === 0) {
        return this.getLabelForValue(value);
      }
      return "";
    }
  },
  grid: {
    color: "rgba(255,255,255,0.1)"
  },
  title: {
    display: true,
    text: "Zeit",
    color: "#ffffff"
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
  updateGlucoseColor();

  data.labels.push(`Tag ${day} ${String(hour).padStart(2, "0")}:00`);
data.datasets[0].data.push(blutzucker);

if (maxDays !== "all") {
  const maxPoints = maxDays * 24;

  while (data.labels.length > maxPoints) {
    data.labels.shift();
    data.datasets[0].data.shift();
  }
}

chart.update();



}


// ===== BUTTONS =====
function zucker() {
  blutzucker += 30;
  energy += 5;
  valueSpan.textContent = blutzucker;
  updateAvatar();
  updateGlucoseColor();
  
}

function mahlzeit() {
  blutzucker += 20;
  energy += 3;
  valueSpan.textContent = blutzucker;
  updateAvatar();
  updateGlucoseColor();
}

function sport() {
  blutzucker -= 25;
  energy -= 6;
  valueSpan.textContent = blutzucker;
  updateAvatar();
  updateGlucoseColor();
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
  updateGlucoseColor();

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
let avatarVisible = true;
const avatarCard = document.getElementById("avatarCard");

function toggleAvatar() {
  avatarVisible = !avatarVisible;
  avatarCard.style.display = avatarVisible ? "block" : "none";
}
function changeRange(value) {
  if (value === "all") {
    maxDays = "all";
  } else {
    maxDays = Number(value);
  }
}
function updateGlucoseColor() {
  const glucoseEl = document.querySelector(".glucose-value span");

  if (blutzucker < 70) {
    glucoseEl.style.color = "#ff6b6b"; // rot (Unterzucker)
  } 
  else if (blutzucker > 180) {
    glucoseEl.style.color = "#ffa94d"; // orange (Überzucker)
  } 
  else {
    glucoseEl.style.color = "#4dabf7"; // blau (Normalbereich)
  }
}
