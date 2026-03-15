const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const weatherContent = document.getElementById('weatherContent');
const loader = document.getElementById('loader');

// Elements to update
const cityNameEl = document.getElementById('cityName');
const dateEl = document.getElementById('currentDate');
const tempEl = document.getElementById('temperature');
const descEl = document.getElementById('weatherDesc');
const humidityEl = document.getElementById('humidity');
const windEl = document.getElementById('windSpeed');
const mainIcon = document.getElementById('mainIcon');
const bgAnimate = document.getElementById('bgAnimate');
const historyGrid = document.getElementById('historyGrid');

// Navigation elements
const prevWeekBtn = document.getElementById('prevWeek');
const nextWeekBtn = document.getElementById('nextWeek');
const weekLabel = document.getElementById('weekLabel');
const themeToggle = document.getElementById('themeToggle');
const eyeToggle = document.getElementById('eyeToggle');
const installBtn = document.getElementById('installBtn');

let deferredPrompt;

let currentForecastData = null;
let currentWeekOffset = 0;
let tempChart = null;
let refreshIntervalId = null;
let currentCoords = null; // Store current lat/lon/name/country for auto-refresh

let radarMap = null;
let radarLayer = null;
let radarTimestamps = [];
let radarCursor = 0;

function animateValue(element, start, end, duration, suffix = "") {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = Math.floor(progress * (end - start) + start);
        element.textContent = value + suffix;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

const suggestionsList = document.getElementById('suggestionsList');
let debounceTimer;

async function getWeatherData(city) {
    showLoader(true);
    try {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar&format=json`);
        const geoData = await geoRes.json();
        
        if (!geoData.results || geoData.results.length === 0) throw new Error('City not found');
        const { latitude, longitude, name, country } = geoData.results[0];
        await fetchAndDisplayWeather(latitude, longitude, name, country);
    } catch (error) {
        console.error(error);
        alert('حدث خطأ: تأكد من اسم المدينة باللغة العربية أو الإنجليزية.');
    } finally {
        showLoader(false);
    }
}

async function fetchAndDisplayWeather(latitude, longitude, name, country) {
    try {
        currentCoords = { latitude, longitude, name, country };
        // Fetch ECMWF data
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&hourly=temperature_2m&timezone=auto&models=ecmwf_ifs&forecast_days=16`);
        
        if (!weatherRes.ok) throw new Error('فشل استرجاع بيانات الطقس');
        
        const weatherData = await weatherRes.json();

        currentForecastData = weatherData;
        currentWeekOffset = 0;
        updateUI(weatherData, name, country);
        renderChart(weatherData.hourly);
        
        updateMap(latitude, longitude);
        setupAutoRefresh();
    } catch (error) {
        console.error("Weather fetch failed:", error);
        alert('خطأ في الاتصال: يرجى التحقق من جودة الإنترنت.');
    }
}

function setupAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        if (currentCoords) {
            console.log("Auto-refreshing weather data for:", currentCoords.name);
            fetchAndDisplayWeather(currentCoords.latitude, currentCoords.longitude, currentCoords.name, currentCoords.country);
        }
    }, 600000); // 10 minutes
}

async function initGeolocation() {
    showLoader(true);
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            try {
                // Try to get city name from coordinates using OpenStreetMap Nominatim
                const reverseGeoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=ar`);
                const reverseGeoData = await reverseGeoRes.json();
                
                const city = reverseGeoData.address.city || reverseGeoData.address.town || reverseGeoData.address.village || "موقعي الحالي";
                const country = reverseGeoData.address.country || "";
                
                await fetchAndDisplayWeather(latitude, longitude, city, country);
                showLoader(false);
            } catch (error) {
                console.error("Reverse geocoding failed", error);
                getWeatherData('القاهرة'); // Fallback
            }
        }, (error) => {
            console.warn("Geolocation permission denied or failed", error);
            getWeatherData('القاهرة'); // Fallback
        });
    } else {
        getWeatherData('القاهرة'); // Fallback if not supported
    }
}

function updateUI(data, cityName, country) {
    const current = data.current;
    cityNameEl.textContent = `${cityName}, ${country}`;
    dateEl.textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    
    // Update last updated time
    const now = new Date();
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `تحدث الآن: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    // Animate values
    const currentTemp = parseInt(tempEl.textContent) || 0;
    const currentHumidity = parseInt(humidityEl.textContent) || 0;
    const currentWind = parseInt(windEl.textContent) || 0;

    animateValue(tempEl, currentTemp, Math.round(current.temperature_2m), 1000);
    
    // Apply freezing color if below zero
    if (current.temperature_2m < 0) {
        tempEl.classList.add('temp-freezing');
    } else {
        tempEl.classList.remove('temp-freezing');
    }

    animateValue(humidityEl, currentHumidity, current.relative_humidity_2m, 800, "%");
    animateValue(windEl, currentWind, Math.round(current.wind_speed_10m), 800, " كم/س");
    
    const weatherInfo = getWeatherInfo(current.weather_code);
    descEl.textContent = weatherInfo.text;

    updateIcon(weatherInfo.icon);
    updateBackground(weatherInfo.type);
    renderWeeklyForecast();
    
    weatherContent.classList.remove('hidden');
}

function renderChart(hourlyData) {
    const ctx = document.getElementById('tempChart').getContext('2d');
    
    const labels = hourlyData.time.slice(0, 24).map(t => new Date(t).getHours() + ':00');
    const temps = hourlyData.temperature_2m.slice(0, 24);

    if (tempChart) tempChart.destroy();

    // Create dynamic vertical gradient based on temperatures
    // We create a gradient that covers the full height of the chart
    const chartHeight = 220; 
    const minTemp = Math.min(...temps) - 2;
    const maxTemp = Math.max(...temps) + 2;
    const range = maxTemp - minTemp;

    const stopBlue = Math.max(0, Math.min(1, (maxTemp - 10) / range));    // Cold threshold at 10C
    const stopOrange = Math.max(0, Math.min(1, (maxTemp - 20) / range));  // Moderate start
    const stopRed = Math.max(0, Math.min(1, (maxTemp - 28) / range));     // Hot threshold at 28C (adjusted for better visual)

    const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    // Colors: Red (hot) top, Orange (moderate) middle, Blue (cold) bottom
    gradient.addColorStop(0, 'rgba(255, 59, 48, 0.4)');   // Red
    gradient.addColorStop(0.5, 'rgba(255, 149, 0, 0.4)'); // Orange
    gradient.addColorStop(1, 'rgba(0, 122, 255, 0.4)');   // Blue

    const lineGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    lineGradient.addColorStop(0, '#ff3b30'); // Red
    lineGradient.addColorStop(0.5, '#ff9500'); // Orange
    lineGradient.addColorStop(1, '#007aff'); // Blue

    tempChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: temps,
                borderColor: lineGradient,
                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: lineGradient,
                fill: true,
                backgroundColor: gradient,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            },
            scales: {
                x: { 
                    display: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { size: 10 } }
                },
                y: { 
                    display: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { size: 10 } },
                    suggestedMin: minTemp,
                    suggestedMax: maxTemp
                }
            }
        }
    });
}

function renderWeeklyForecast() {
    if (!currentForecastData) return;
    historyGrid.innerHTML = '';
    const daily = currentForecastData.daily;
    const startIndex = currentWeekOffset * 7;
    const endIndex = Math.min(startIndex + 7, daily.time.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        const date = new Date(daily.time[i]);
        const dayLabel = i === 0 ? 'اليوم' : new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(date);
        const info = getWeatherInfo(daily.weather_code[i]);
        
        const div = document.createElement('div');
        div.className = 'history-day';
        // Add staggered delay
        div.style.animationDelay = `${(i - startIndex) * 0.1}s`;
        
        const tempMax = Math.round(daily.temperature_2m_max[i]);
        const tempClass = tempMax < 0 ? 'temp-freezing-simple' : '';

        div.innerHTML = `
            <span>${dayLabel}</span>
            <i data-lucide="${info.icon}" size="24"></i>
            <strong class="${tempClass}">${tempMax}°</strong>
        `;
        historyGrid.appendChild(div);
    }
    lucide.createIcons();
    updateNavigationUI();
}

function updateNavigationUI() {
    weekLabel.textContent = currentWeekOffset === 0 ? 'الأسبوع الحالي' : 'الأسبوع القادم';
    prevWeekBtn.disabled = currentWeekOffset === 0;
    nextWeekBtn.disabled = currentWeekOffset === 1 || !currentForecastData;
}

function getWeatherInfo(code) {
    if (code === 0) return { text: 'سماء صافية', icon: 'sun', type: 'clear' };
    if (code <= 3) return { text: 'غائم جزئياً', icon: 'cloud-sun', type: 'cloud' };
    if (code <= 48) return { text: 'ضبابي', icon: 'cloud', type: 'cloud' };
    if (code <= 67) return { text: 'مطر خفيف', icon: 'cloud-rain', type: 'rain' };
    if (code <= 82) return { text: 'زخات مطر', icon: 'cloud-drizzle', type: 'rain' };
    if (code >= 95) return { text: 'عواصف رعدية', icon: 'cloud-lightning', type: 'storm' };
    return { text: 'متقلب', icon: 'cloud', type: 'cloud' };
}

function updateIcon(iconName) {
    mainIcon.setAttribute('data-lucide', iconName);
    lucide.createIcons();
}

function updateBackground(type) {
    let gradient = 'linear-gradient(45deg, #050505, #121020, #0a0a1a)';
    if (type === 'clear') gradient = 'linear-gradient(45deg, #001f3f, #003366, #050505)';
    if (type === 'rain') gradient = 'linear-gradient(45deg, #0f172a, #1e293b, #050505)';
    if (type === 'storm') gradient = 'linear-gradient(45deg, #020617, #0f172a, #1e293b)';
    if (type === 'cloud') gradient = 'linear-gradient(45deg, #1e293b, #334155, #050505)';
    
    bgAnimate.style.background = gradient;
    bgAnimate.style.backgroundSize = '400% 400%';
}

function showLoader(show) {
    if (show) {
        loader.classList.remove('hidden');
        weatherContent.classList.add('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

searchBtn.addEventListener('click', () => {
    if (cityInput.value) getWeatherData(cityInput.value);
});

cityInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && cityInput.value) getWeatherData(cityInput.value);
});

nextWeekBtn.addEventListener('click', () => {
    if (currentWeekOffset < 1) {
        currentWeekOffset++;
        renderWeeklyForecast();
    }
});

prevWeekBtn.addEventListener('click', () => {
    if (currentWeekOffset > 0) {
        currentWeekOffset--;
        renderWeeklyForecast();
    }
});

// Theme Toggling logic
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    // Init Eye Comfort
    const eyeComfort = localStorage.getItem('eyeComfort') === 'true';
    if (eyeComfort) {
        document.body.classList.add('eye-comfort-active');
        eyeToggle.classList.add('active');
    }
}

function updateThemeIcon(theme) {
    const icon = theme === 'dark' ? 'moon' : 'sun';
    themeToggle.innerHTML = `<i data-lucide="${icon}"></i>`;
    lucide.createIcons();
}

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
});

eyeToggle.addEventListener('click', () => {
    const isActive = document.body.classList.toggle('eye-comfort-active');
    eyeToggle.classList.toggle('active');
    localStorage.setItem('eyeComfort', isActive);
});

// Search suggestions logic
cityInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(debounceTimer);
    
    if (val.length < 2) {
        suggestionsList.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(val)}&count=5&language=ar&format=json`);
            const data = await res.json();
            
            if (data.results && data.results.length > 0) {
                renderSuggestions(data.results);
            } else {
                suggestionsList.classList.add('hidden');
            }
        } catch (error) {
            console.error(error);
        }
    }, 400);
});

function renderSuggestions(results) {
    suggestionsList.innerHTML = '';
    results.forEach(city => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <span>${city.name}</span>
            <span class="country">${city.country || ''}</span>
        `;
        div.addEventListener('click', () => {
            cityInput.value = city.name;
            getWeatherData(city.name);
            suggestionsList.classList.add('hidden');
        });
        suggestionsList.appendChild(div);
    });
    suggestionsList.classList.remove('hidden');
}

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!cityInput.contains(e.target) && !suggestionsList.contains(e.target)) {
        suggestionsList.classList.add('hidden');
    }
});

// Map & Radar Logic
function updateMap(lat, lon) {
    if (!radarMap) {
        radarMap = L.map('radarMap', {
            zoomControl: true,
            attributionControl: true
        }).setView([lat, lon], 6);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(radarMap);

        initRadar();
    } else {
        radarMap.setView([lat, lon], 6);
    }
}

async function initRadar() {
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        
        radarTimestamps = data.radar.past.concat(data.radar.nowcast);
        radarCursor = data.radar.past.length - 1; // Start at current time
        
        updateRadarLayer();
    } catch (error) {
        console.error("Radar data fetch failed", error);
    }
}

function updateRadarLayer() {
    if (radarLayer) radarMap.removeLayer(radarLayer);
    
    const ts = radarTimestamps[radarCursor].time;
    const radarUrl = `https://tilecache.rainviewer.com/v2/radar/${ts}/512/{z}/{x}/{y}/2/1_1.png`;
    
    radarLayer = L.tileLayer(radarUrl, {
        opacity: 0.6,
        zIndex: 100
    }).addTo(radarMap);

    const date = new Date(ts * 1000);
    const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
    document.getElementById('radarTime').textContent = `وقت الرادار: ${timeStr}`;
}

// Initial load
initTheme();
initGeolocation();

// Check if already installed
if (window.matchMedia('(display-mode: standalone)').matches) {
    installBtn.classList.add('hidden');
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}

// PWA Install Logic
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Ensure it's visible if the prompt is supported
    installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.classList.add('hidden');
        }
        deferredPrompt = null;
    } else {
        // Fallback for when native prompt isn't supported (e.g. file:// or no HTTPS)
        alert('طريقة تثبيت التطبيق:\n\n1. اضغط على زر الخيارات ( الثلاث نقاط) في متصفحك.\n2. اختر "تثبيت التطبيق" أو "Install App".\n\nهذا يتيح لك تثبيت "طقس نقي" كبرنامج مستقل على جهازك.');
    }
});
