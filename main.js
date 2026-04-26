import * as turf from 'https://esm.sh/@turf/turf@6.5.0';

// Define a premium and vibrant color palette for the 12 Bezirke
const bezirkColors = {
  "Mitte": "#FF3366",
  "Friedrichshain-Kreuzberg": "#33CC99",
  "Pankow": "#3399FF",
  "Charlottenburg-Wilmersdorf": "#FF9933",
  "Spandau": "#9933FF",
  "Steglitz-Zehlendorf": "#3366FF",
  "Tempelhof-Schöneberg": "#FF33CC",
  "Neukölln": "#33FFCC",
  "Treptow-Köpenick": "#FFCC33",
  "Marzahn-Hellersdorf": "#E024B1",
  "Lichtenberg": "#FF6633",
  "Reinickendorf": "#CC33FF"
};

const regionMap = {
  "alle": "alle",
  "mitte": ["Mitte"],
  "friedrichshain_kreuzberg": ["Friedrichshain-Kreuzberg"],
  "pankow": ["Pankow"],
  "charlottenburg_wilmersdorf": ["Charlottenburg-Wilmersdorf"],
  "spandau": ["Spandau"],
  "steglitz_zehlendorf": ["Steglitz-Zehlendorf"],
  "tempelhof_schoeneberg": ["Tempelhof-Schöneberg"],
  "neukoelln": ["Neukölln"],
  "treptow_koepenick": ["Treptow-Köpenick"],
  "marzahn_hellersdorf": ["Marzahn-Hellersdorf"],
  "lichtenberg": ["Lichtenberg"],
  "reinickendorf": ["Reinickendorf"]
};

function getBezirkColor(bezirkName) {
  if (bezirkColors[bezirkName]) return bezirkColors[bezirkName];
  let hash = 0;
  for (let i = 0; i < bezirkName.length; i++) hash = bezirkName.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 80%, 60%)`;
}

// State Management
const appState = {
  mode: 'lernen', // 'lernen' | 'spielen'
  customGeojson: null, // Stores the uploaded FeatureCollection
  difficulty: 1, // 1: Tourist, 2: Resident, 3: Taxi Driver
  region: 'friedrichshain_kreuzberg',
  radiusMode: {
    active: false,
    center: null,
    radiusKm: 2,
    isSelectingCenter: false,
    hasCenter: false
  },
  spielen: {
    inProgress: false,
    allTargets: [], // now stores unique names
    remainingTargets: [],
    currentTargetName: null,
    attempts: 0,
    lastStartTime: null,
    elapsedBefore: 0,
    stats: { green: 0, orange: 0, red: 0 }
  }
};

// Initialize MapLibre Map
const map = new maplibregl.Map({
  dragRotate: false,
  touchPitch: false,
  touchZoomRotate: false,
  container: 'map',
  style: {
    version: 8,
    sources: {
      'carto-base': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      },
      'carto-labels': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    },
    layers: [
      {
        id: 'carto-base-layer',
        type: 'raster',
        source: 'carto-base',
        minzoom: 0,
        maxzoom: 22
      },
      {
        id: 'carto-labels-layer',
        type: 'raster',
        source: 'carto-labels',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          'visibility': 'none'
        }
      }
    ]
  },
  center: [13.4050, 52.5200], // MapLibre is [lng, lat]
  zoom: 11,
  attributionControl: false
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

let mapLoaded = false;
let currentGeojsonData = null;
let hoveredFeatureId = null;
let selectedFeatureId = null;
let currentDistrictGeojsonData = null;
let errorMarkers = [];

// DOM Elements
const btnLernen = document.getElementById('btn-lernen');
const btnSpielen = document.getElementById('btn-spielen');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnSkipTarget = document.getElementById('btn-skip-target');
const lernenContent = document.getElementById('lernen-content');
const spielenContent = document.getElementById('spielen-content');
const bezirkTitleEl = document.getElementById('bezirk-title');
const ortsteilNameEl = document.getElementById('ortsteil-name');
const targetNameEl = document.getElementById('target-name');
const progressTextEl = document.getElementById('progress-text');
const dots = document.querySelectorAll('.dot');
const statsModal = document.getElementById('stats-modal');
const btnRestart = document.getElementById('btn-restart');
const btnCloseStats = document.getElementById('btn-close-stats');

const toggleErrorNames = document.getElementById('toggle-error-names');
const toggleHoverRed = document.getElementById('toggle-hover-red');
const toggleMapLabels = document.getElementById('toggle-map-labels');
const mapStyleSelect = document.getElementById('map-style-select');
const regionSelect = document.getElementById('region-select');
const difficultySelect = document.getElementById('difficulty-select');
const btnConfigFilter = document.getElementById('btn-config-filter');

const radiusConfig = document.getElementById('radius-config');
const radiusSlider = document.getElementById('radius-slider');
const radiusDisplay = document.getElementById('radius-display');
const btnSelectCenter = document.getElementById('btn-select-center');

const filterModal = document.getElementById('filter-modal');
const btnSaveFilter = document.getElementById('btn-save-filter');
const filterFileUpload = document.getElementById('filter-file-upload');
const filterUploadStatus = document.getElementById('filter-upload-status');
const customTooltip = document.getElementById('custom-tooltip');

// Map Event Listeners
map.on('load', () => {
  mapLoaded = true;

  // Add bezirksgrenzen source and layer
  map.addSource('bezirke', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'bezirke-layer',
    type: 'line',
    source: 'bezirke',
    paint: {
      'line-color': '#0f172a',
      'line-width': 3,
      'line-opacity': 0.8
    }
  });

  // Fetch bezirksgrenzen
  fetch('./bezirksgrenzen.geojson')
    .then(resp => resp.json())
    .then(data => { map.getSource('bezirke').setData(data); })
    .catch(err => console.error("Could not load bezirksgrenzen.geojson", err));

  // Check for custom map from editor
  const savedCustomMap = localStorage.getItem('berlinmemo_custom_map');
  if (savedCustomMap) {
    try {
      const geojson = JSON.parse(savedCustomMap);
      if (geojson && geojson.type === 'FeatureCollection' && geojson.features.length > 0) {
        appState.customGeojson = geojson;
        // If we have custom data and we're just coming back from the editor, or if it's the only custom data we have,
        // we can default to it. 
        appState.region = 'custom';
        regionSelect.value = 'custom';
        btnConfigFilter.classList.remove('hidden');
      }
    } catch (e) {
      console.error("Error loading custom map from localStorage", e);
    }
  }

  syncDifficultyState();

  // Add radius circle source and layer
  map.addSource('radius-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'radius-circle-layer',
    type: 'line',
    source: 'radius-circle',
    paint: {
      'line-color': '#3b82f6',
      'line-width': 3,
      'line-dasharray': [2, 1]
    }
  });

  // Add streets source and layer
  map.addSource('streets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'name' }); // Use name to group fragmented lines
  
  // Style for streets (LineStrings)
  map.addLayer({
    id: 'streets-layer',
    type: 'line',
    source: 'streets',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    paint: {
      'line-color': [
        'case',
        ['==', ['feature-state', 'state'], 'green'], '#10b981',
        ['==', ['feature-state', 'state'], 'orange'], '#f59e0b',
        ['==', ['feature-state', 'state'], 'red'], '#ef4444',
        ['boolean', ['feature-state', 'hover'], false], '#1e3a8a',
        ['boolean', ['feature-state', 'selected'], false], '#1e3a8a',
        '#3b82f6' // default
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 8,
        ['boolean', ['feature-state', 'selected'], false], 8,
        ['!=', ['feature-state', 'state'], null], 6,
        4 // default
      ],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 1,
        ['boolean', ['feature-state', 'selected'], false], 1,
        ['!=', ['feature-state', 'state'], null], 1,
        0.8 // default
      ]
    }
  });

  // Style for points (Points)
  map.addLayer({
    id: 'streets-point-layer',
    type: 'circle',
    source: 'streets',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 10,
        ['boolean', ['feature-state', 'selected'], false], 10,
        ['!=', ['feature-state', 'state'], null], 9,
        7 // default
      ],
      'circle-color': [
        'case',
        ['==', ['feature-state', 'state'], 'green'], '#10b981',
        ['==', ['feature-state', 'state'], 'orange'], '#f59e0b',
        ['==', ['feature-state', 'state'], 'red'], '#ef4444',
        ['boolean', ['feature-state', 'hover'], false], '#1e3a8a',
        ['boolean', ['feature-state', 'selected'], false], '#1e3a8a',
        '#3b82f6' // default
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Errors source and layer removed in favor of DOM markers

  setupMapInteractions();
  loadStreetData(appState.difficulty, appState.region);
});

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const CLICK_TOLERANCE = isMobile ? 14 : 4;

function setupMapInteractions() {
  const interactiveLayers = ['streets-layer', 'streets-point-layer'];

  // Helper to find features under/near a point
  const getFeatureAtPoint = (point) => {
    const bbox = [
      [point.x - CLICK_TOLERANCE, point.y - CLICK_TOLERANCE],
      [point.x + CLICK_TOLERANCE, point.y + CLICK_TOLERANCE]
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: interactiveLayers });
    return features.length > 0 ? features[0] : null;
  };

  // Hover effect using map-wide mousemove
  map.on('mousemove', (e) => {
    if (appState.radiusMode.isSelectingCenter) {
      map.getCanvas().style.cursor = 'crosshair';
      return;
    }

    const feature = getFeatureAtPoint(e.point);
    
    if (feature) {
      map.getCanvas().style.cursor = 'pointer';
      const id = feature.id;

      if (hoveredFeatureId !== id) {
        if (hoveredFeatureId !== null) {
          map.setFeatureState({ source: 'streets', id: hoveredFeatureId }, { hover: false });
        }
        hoveredFeatureId = id;
        map.setFeatureState({ source: 'streets', id: hoveredFeatureId }, { hover: true });
        
        if (appState.mode === 'lernen') {
          updateHeaderInfo(feature.properties.name, feature.properties.BEZIRK || 'Unbekannt');
        }
      }

      // Tooltip position and content
      let showTooltip = false;
      if (appState.mode === 'lernen' || (appState.mode === 'spielen' && !appState.spielen.inProgress)) {
        showTooltip = true;
      } else if (appState.mode === 'spielen' && appState.spielen.inProgress && toggleHoverRed && toggleHoverRed.checked) {
        // Check if feature is answered (green, orange, or red)
        const state = map.getFeatureState({ source: 'streets', id: feature.id });
        if (state && state.state) {
          showTooltip = true;
        }
      }

      if (showTooltip) {
        let tooltipHtml = feature.properties.name;
        if (feature.properties.notes) {
          tooltipHtml += `<br><span style="font-size: 0.8em; opacity: 0.8;">${feature.properties.notes}</span>`;
        }
        customTooltip.innerHTML = tooltipHtml;
        customTooltip.style.left = e.point.x + 'px';
        customTooltip.style.top = e.point.y + 'px';
        customTooltip.classList.add('visible');
      } else {
        customTooltip.classList.remove('visible');
      }
    } else {
      // No feature found
      map.getCanvas().style.cursor = '';
      customTooltip.classList.remove('visible');
      if (hoveredFeatureId !== null) {
        map.setFeatureState({ source: 'streets', id: hoveredFeatureId }, { hover: false });
        hoveredFeatureId = null;
      }
      if (appState.mode === 'lernen') {
        if (selectedFeatureId !== null) {
          // Keep header showing selected feature
          const f = currentGeojsonData.features.find(f => f.id === selectedFeatureId);
          if (f) updateHeaderInfo(f.properties.name, f.properties.BEZIRK || 'Unbekannt');
        } else {
          resetHeaderInfo();
        }
      }
    }
  });

  // Handle map clicks
  map.on('click', (e) => {
    // 1. Center selection mode
    if (appState.radiusMode.isSelectingCenter) {
      appState.radiusMode.center = [e.lngLat.lng, e.lngLat.lat];
      appState.radiusMode.isSelectingCenter = false;
      appState.radiusMode.hasCenter = true;
      map.getCanvas().style.cursor = '';
      btnSelectCenter.textContent = "Zentrum auf Karte wählen";
      btnSelectCenter.style.backgroundColor = "";
      loadStreetData(appState.difficulty, appState.region);
      return;
    }

    // 2. Interactive features selection (Lernen or Spielen)
    const feature = getFeatureAtPoint(e.point);
    if (feature) {
      if (appState.mode === 'lernen') {
        if (selectedFeatureId !== null) {
          map.setFeatureState({ source: 'streets', id: selectedFeatureId }, { selected: false });
        }
        selectedFeatureId = feature.id;
        map.setFeatureState({ source: 'streets', id: selectedFeatureId }, { selected: true });
        updateHeaderInfo(feature.properties.name, feature.properties.BEZIRK || 'Unbekannt');
      } else if (appState.mode === 'spielen') {
        handleSpielenClick(feature, e.lngLat);
      }
    }
  });
}

function updateHeaderInfo(name, bezirk) {
  bezirkTitleEl.textContent = name;
  ortsteilNameEl.textContent = `Bezirk: ${bezirk}`;
  bezirkTitleEl.style.background = `linear-gradient(135deg, #FFFFFF 0%, ${getBezirkColor(bezirk)} 100%)`;
  bezirkTitleEl.style.webkitBackgroundClip = 'text';
  bezirkTitleEl.style.webkitTextFillColor = 'transparent';
}

function resetHeaderInfo() {
  bezirkTitleEl.textContent = "Berlin";
  ortsteilNameEl.textContent = "Wähle eine Straße";
  bezirkTitleEl.style.background = `linear-gradient(135deg, #FFFFFF 0%, #A5B4FC 100%)`;
  bezirkTitleEl.style.webkitBackgroundClip = 'text';
  bezirkTitleEl.style.webkitTextFillColor = 'transparent';
}

// Mode Listeners
btnLernen.addEventListener('click', () => switchMode('lernen'));
btnSpielen.addEventListener('click', () => switchMode('spielen'));
btnRestart.addEventListener('click', () => {
  appState.spielen.inProgress = false;
  switchMode('spielen');
});
if (btnCloseStats) {
  btnCloseStats.addEventListener('click', () => {
    statsModal.classList.add('hidden');
  });
}
if (btnRestartGame) {
  btnRestartGame.addEventListener('click', () => {
    appState.spielen.inProgress = false;
    startSpielenMode();
  });
}
if (btnSkipTarget) {
  btnSkipTarget.addEventListener('click', () => skipTarget());
}
regionSelect.addEventListener('change', () => {
  btnConfigFilter.classList.toggle('hidden', regionSelect.value !== 'custom');
  radiusConfig.classList.toggle('hidden', regionSelect.value !== 'radius');
  appState.radiusMode.active = (regionSelect.value === 'radius');
  appState.spielen.inProgress = false;
  appState.region = regionSelect.value;
  
  if (appState.region === 'custom') {
    document.getElementById('settings-menu').classList.add('hidden');
    filterModal.classList.remove('hidden');
  }
  
  if (appState.radiusMode.active) {
    appState.radiusMode.isSelectingCenter = true;
    appState.radiusMode.hasCenter = false;
    map.getCanvas().style.cursor = 'crosshair';
    btnSelectCenter.textContent = "Klicke auf die Karte...";
    btnSelectCenter.style.backgroundColor = "#f59e0b"; // Orange
    
    // Clear the map
    if (map.getSource('streets')) {
      map.getSource('streets').setData({ type: 'FeatureCollection', features: [] });
    }
    if (map.getSource('radius-circle')) {
      map.getSource('radius-circle').setData({ type: 'FeatureCollection', features: [] });
    }
    
    ortsteilNameEl.textContent = "Wähle ein Zentrum auf der Karte...";
    bezirkTitleEl.textContent = "Umkreis-Modus";
    bezirkTitleEl.style.background = `linear-gradient(135deg, #FFFFFF 0%, #A5B4FC 100%)`;
    bezirkTitleEl.style.webkitBackgroundClip = 'text';
    bezirkTitleEl.style.webkitTextFillColor = 'transparent';
  } else {
    appState.radiusMode.isSelectingCenter = false;
    map.getCanvas().style.cursor = '';
    btnSelectCenter.textContent = "Zentrum auf Karte wählen";
    btnSelectCenter.style.backgroundColor = "";
    loadStreetData(appState.difficulty, appState.region);
  }
  syncDifficultyState();
});

function syncDifficultyState() {
  const isCustom = regionSelect.value === 'custom';
  difficultySelect.disabled = isCustom;
  
  const label = document.querySelector('label[for="difficulty-select"]');
  if (label) {
    label.style.opacity = isCustom ? '0.5' : '1';
  }

  if (isCustom) {
    difficultySelect.title = "Bei eigenen Karten werden immer alle Elemente angezeigt.";
  } else {
    difficultySelect.title = "";
  }
}

radiusSlider.addEventListener('input', (e) => {
  radiusDisplay.textContent = e.target.value;
});

radiusSlider.addEventListener('change', (e) => {
  appState.radiusMode.radiusKm = parseFloat(e.target.value);
  if (appState.radiusMode.active && appState.radiusMode.hasCenter) {
    loadStreetData(appState.difficulty, appState.region);
  }
});

btnSelectCenter.addEventListener('click', () => {
  appState.radiusMode.isSelectingCenter = !appState.radiusMode.isSelectingCenter;
  if (appState.radiusMode.isSelectingCenter) {
    map.getCanvas().style.cursor = 'crosshair';
    btnSelectCenter.textContent = "Klicke auf die Karte...";
    btnSelectCenter.style.backgroundColor = "#f59e0b"; // Orange
  } else {
    map.getCanvas().style.cursor = '';
    btnSelectCenter.textContent = "Zentrum auf Karte wählen";
    btnSelectCenter.style.backgroundColor = "";
  }
});
difficultySelect.addEventListener('change', () => {
  appState.difficulty = parseInt(difficultySelect.value);
  appState.spielen.inProgress = false;
  loadStreetData(appState.difficulty, appState.region);
});

document.getElementById('btn-settings').addEventListener('click', (e) => {
  document.getElementById('settings-menu').classList.toggle('hidden');
});

const btnCloseSettings = document.getElementById('btn-close-settings');
if (btnCloseSettings) {
  btnCloseSettings.addEventListener('click', () => {
    document.getElementById('settings-menu').classList.add('hidden');
  });
}

document.addEventListener('click', (e) => {
  const settingsMenu = document.getElementById('settings-menu');
  const btnSettings = document.getElementById('btn-settings');
  if (!settingsMenu.classList.contains('hidden')) {
    if (!settingsMenu.contains(e.target) && !btnSettings.contains(e.target)) {
      settingsMenu.classList.add('hidden');
    }
  }
});

toggleMapLabels.addEventListener('change', () => {
  if (map.getLayer('carto-labels-layer')) {
    map.setLayoutProperty('carto-labels-layer', 'visibility', toggleMapLabels.checked ? 'visible' : 'none');
  }
});

const mapStyles = {
  light: {
    base: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    labels: 'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
  },
  dark: {
    base: 'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    labels: 'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
  },
  voyager: {
    base: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    labels: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'
  }
};

mapStyleSelect.addEventListener('change', () => {
  const style = mapStyles[mapStyleSelect.value];
  if (style) {
    if (map.getSource('carto-base')) {
      map.getSource('carto-base').setTiles([style.base]);
    }
    if (map.getSource('carto-labels')) {
      map.getSource('carto-labels').setTiles([style.labels]);
    }
  }
});


// Modal Logic
btnConfigFilter.addEventListener('click', () => {
  document.getElementById('settings-menu').classList.add('hidden');
  filterModal.classList.remove('hidden');
});

btnSaveFilter.addEventListener('click', () => {
  filterModal.classList.add('hidden');
  appState.spielen.inProgress = false;
  loadStreetData(appState.difficulty, appState.region);
});

if (filterFileUpload) {
  filterFileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const geojson = JSON.parse(evt.target.result);
        if (geojson.type === 'FeatureCollection') {
          appState.customGeojson = geojson;
          filterUploadStatus.style.display = 'block';
          
          setTimeout(() => { 
            filterUploadStatus.style.display = 'none'; 
            filterModal.classList.add('hidden');
            appState.spielen.inProgress = false;
            loadStreetData(appState.difficulty, appState.region);
            
            // clear the file input so the same file can be selected again if needed
            filterFileUpload.value = '';
          }, 600);
        } else {
          alert('Ungültiges GeoJSON Format. Muss eine FeatureCollection sein.');
        }
      } catch (err) {
        alert('Fehler beim Lesen der Datei: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
}

function updateMapStylesForMode(mode) {
  if (!mapLoaded) return;
  const isSpielen = (mode === 'spielen');

  // Update Line Style
  map.setPaintProperty('streets-layer', 'line-color', [
    'case',
    ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'green']], '#10b981',
    ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'orange']], '#f59e0b',
    ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'red']], '#ef4444',
    ['boolean', ['feature-state', 'hover'], false], '#1e3a8a',
    ['boolean', ['feature-state', 'selected'], false], '#1e3a8a',
    '#3b82f6' // default
  ], { validate: false });

  map.setPaintProperty('streets-layer', 'line-width', [
    'case',
    ['boolean', ['feature-state', 'hover'], false], 8,
    ['boolean', ['feature-state', 'selected'], false], 8,
    ['all', ['literal', isSpielen], ['!=', ['feature-state', 'state'], null]], 6,
    4 // default
  ], { validate: false });

  // Update Point Style
  if (map.getLayer('streets-point-layer')) {
    map.setPaintProperty('streets-point-layer', 'circle-color', [
      'case',
      ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'green']], '#10b981',
      ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'orange']], '#f59e0b',
      ['all', ['literal', isSpielen], ['==', ['feature-state', 'state'], 'red']], '#ef4444',
      ['boolean', ['feature-state', 'hover'], false], '#1e3a8a',
      ['boolean', ['feature-state', 'selected'], false], '#1e3a8a',
      '#3b82f6' // default
    ], { validate: false });

    map.setPaintProperty('streets-point-layer', 'circle-radius', [
      'case',
      ['boolean', ['feature-state', 'hover'], false], 10,
      ['boolean', ['feature-state', 'selected'], false], 10,
      ['all', ['literal', isSpielen], ['!=', ['feature-state', 'state'], null]], 9,
      7 // default
    ], { validate: false });
  }
}

function switchMode(mode) {
  if (appState.mode === 'spielen' && mode !== 'spielen' && appState.spielen.inProgress) {
    appState.spielen.elapsedBefore += (new Date() - appState.spielen.lastStartTime);
  }
  
  appState.mode = mode;
  updateMapStylesForMode(mode);

  if (mode === 'lernen') {
    btnLernen.classList.add('active');
    btnSpielen.classList.remove('active');
    lernenContent.classList.remove('hidden');
    spielenContent.classList.add('hidden');
    statsModal.classList.add('hidden');
    if (btnRestartGame) btnRestartGame.style.display = 'none';
    if (btnSkipTarget) btnSkipTarget.style.display = 'none';
    resetLernenMode();
  } else {
    btnSpielen.classList.add('active');
    btnLernen.classList.remove('active');
    spielenContent.classList.remove('hidden');
    lernenContent.classList.add('hidden');
    statsModal.classList.add('hidden');
    if (btnRestartGame) btnRestartGame.style.display = 'flex';
    if (btnSkipTarget) btnSkipTarget.style.display = 'flex';
    resumeSpielenMode();
  }
}

function resetLernenMode() {
  if (!mapLoaded || !currentGeojsonData) return;
  // Clear only temporary interaction states, keep 'state' (game progress)
  map.removeFeatureState({ source: 'streets' }, 'hover');
  map.removeFeatureState({ source: 'streets' }, 'selected');
  selectedFeatureId = null;
  hoveredFeatureId = null;
  resetHeaderInfo();
  fitMapToBounds();
}

function resumeSpielenMode() {
  if (!mapLoaded || !currentGeojsonData) return;
  if (!appState.spielen.inProgress) {
    startSpielenMode();
    return;
  }
  
  appState.spielen.lastStartTime = new Date();
  
  // States are preserved in maplibre feature states, just update UI
  if (appState.spielen.currentTargetName) {
    targetNameEl.textContent = appState.spielen.currentTargetName;
  }
  
  const total = appState.spielen.allTargets.length;
  const current = total - appState.spielen.remainingTargets.length;
  progressTextEl.textContent = `${current}/${total}`;

  dots.forEach(d => d.classList.remove('lost'));
  for (let i = 0; i < appState.spielen.attempts && i < 3; i++) {
    dots[3 - (i + 1)].classList.add('lost');
  }

  fitMapToBounds();
}

function startSpielenMode() {
  if (!mapLoaded || !currentGeojsonData) return;
  appState.spielen.inProgress = true;
  appState.spielen.elapsedBefore = 0;
  appState.spielen.lastStartTime = new Date();
  
  // Clear states
  map.removeFeatureState({ source: 'streets' });
  const uniqueNames = new Set();
  currentGeojsonData.features.forEach(f => {
    uniqueNames.add(f.properties.name);
  });
  selectedFeatureId = null;
  hoveredFeatureId = null;
  errorMarkers.forEach(m => m.remove());
  errorMarkers = [];
  
  appState.spielen.allTargets = Array.from(uniqueNames);
  appState.spielen.remainingTargets = [...appState.spielen.allTargets].sort(() => Math.random() - 0.5);
  appState.spielen.stats = { green: 0, orange: 0, red: 0 };
  
  fitMapToBounds();
  pickNextTarget();
}

function pickNextTarget() {
  if (appState.spielen.remainingTargets.length === 0) {
    endGame();
    return;
  }
  appState.spielen.currentTargetName = appState.spielen.remainingTargets.pop();
  appState.spielen.attempts = 0;
  
  targetNameEl.textContent = appState.spielen.currentTargetName;
  
  const total = appState.spielen.allTargets.length;
  const current = total - appState.spielen.remainingTargets.length;
  progressTextEl.textContent = `${current}/${total}`;
  
  dots.forEach(d => d.classList.remove('lost'));
}

function handleSpielenClick(feature, lngLat) {
  const targetName = appState.spielen.currentTargetName;
  if (!targetName) return;

  // Check if already guessed
  const state = map.getFeatureState({ source: 'streets', id: feature.id });
  if (state && state.state) {
    // If setting is active, show the name popup even if already guessed
    if (toggleHoverRed && toggleHoverRed.checked) {
      const el = document.createElement('div');
      el.className = `modern-popup ${state.state === 'red' ? 'error' : ''} visible`;
      el.textContent = feature.properties.name;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(lngLat)
        .addTo(map);
      
      setTimeout(() => marker.remove(), 1200);
    }
    return;
  }

  appState.spielen.attempts++;
  
  if (feature.properties.name === targetName) {
    dots.forEach(d => d.classList.remove('lost'));
    
    const newState = appState.spielen.attempts === 1 ? 'green' : 'orange';
    map.setFeatureState({ source: 'streets', id: targetName }, { state: newState });
    
    if (appState.spielen.attempts === 1) appState.spielen.stats.green++;
    else appState.spielen.stats.orange++;
    
    setTimeout(pickNextTarget, 400);
  } else {
    // Wrong guess
    map.setFeatureState({ source: 'streets', id: feature.id }, { state: 'red' });
    
    const showNames = toggleErrorNames && toggleErrorNames.checked;
    const errorDelay = showNames ? 1200 : 400;
    
    if (showNames) {
      const el = document.createElement('div');
      el.className = 'modern-popup error visible';
      el.textContent = feature.properties.name;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(lngLat)
        .addTo(map);
      errorMarkers.push(marker);
    }

    setTimeout(() => {
      // Revert the red color unless it was actually a previous target (which we don't allow clicking anyway)
      map.setFeatureState({ source: 'streets', id: feature.id }, { state: null });
      if (showNames) {
        // Clear errors
        errorMarkers.forEach(m => m.remove());
        errorMarkers = [];
      }
    }, errorDelay); 
    
    if (appState.spielen.attempts <= 3) dots[3 - appState.spielen.attempts].classList.add('lost');
    
    if (appState.spielen.attempts >= 3) {
      skipTarget();
    }
  }
}

function skipTarget() {
  const targetName = appState.spielen.currentTargetName;
  if (!targetName || !appState.spielen.inProgress) return;

  appState.spielen.stats.red++;
  
  // Color the target red
  map.setFeatureState({ source: 'streets', id: targetName }, { state: 'red' });
  
  let targetFeatureLngLat = null;
  const targetFeature = currentGeojsonData.features.find(f => f.properties.name === targetName);
  if (targetFeature) {
    if (targetFeature.geometry.type === 'LineString') {
      targetFeatureLngLat = targetFeature.geometry.coordinates[Math.floor(targetFeature.geometry.coordinates.length/2)];
    } else if (targetFeature.geometry.type === 'MultiLineString') {
      targetFeatureLngLat = targetFeature.geometry.coordinates[0][0]; // fallback
    } else if (targetFeature.geometry.type === 'Point') {
      targetFeatureLngLat = targetFeature.geometry.coordinates;
    } else if (targetFeature.geometry.type === 'Polygon') {
      targetFeatureLngLat = targetFeature.geometry.coordinates[0][0];
    }
  }

  if (targetFeatureLngLat) {
      const el = document.createElement('div');
      el.className = 'modern-popup error visible';
      el.textContent = targetName;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(targetFeatureLngLat)
        .addTo(map);
      errorMarkers.push(marker);
  }

  appState.spielen.currentTargetName = null; // Disable interaction during delay

  setTimeout(() => {
    errorMarkers.forEach(m => m.remove());
    errorMarkers = [];
    pickNextTarget();
  }, 1200);
}

function endGame() {
  appState.spielen.inProgress = false;
  const elapsedMs = appState.spielen.elapsedBefore + (new Date() - appState.spielen.lastStartTime);
  const elapsed = Math.floor(elapsedMs / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  
  document.getElementById('stat-time').textContent = `${m}:${s}`;
  document.getElementById('stat-green').textContent = appState.spielen.stats.green;
  document.getElementById('stat-orange').textContent = appState.spielen.stats.orange;
  document.getElementById('stat-red').textContent = appState.spielen.stats.red;
  
  statsModal.classList.remove('hidden');
}

function fitMapToBounds() {
  if (!mapLoaded || !currentGeojsonData || currentGeojsonData.features.length === 0) return;
  
  // Calculate bounds manually for MapLibre
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  
  currentGeojsonData.features.forEach(f => {
    if (f.geometry.type === 'LineString') {
      f.geometry.coordinates.forEach(coord => {
        if (coord[0] < minLng) minLng = coord[0];
        if (coord[0] > maxLng) maxLng = coord[0];
        if (coord[1] < minLat) minLat = coord[1];
        if (coord[1] > maxLat) maxLat = coord[1];
      });
    } else if (f.geometry.type === 'MultiLineString' || f.geometry.type === 'Polygon') {
       f.geometry.coordinates.forEach(line => {
         line.forEach(coord => {
          if (coord[0] < minLng) minLng = coord[0];
          if (coord[0] > maxLng) maxLng = coord[0];
          if (coord[1] < minLat) minLat = coord[1];
          if (coord[1] > maxLat) maxLat = coord[1];
        });
       });
    } else if (f.geometry.type === 'Point') {
      const coord = f.geometry.coordinates;
      if (coord[0] < minLng) minLng = coord[0];
      if (coord[0] > maxLng) maxLng = coord[0];
      if (coord[1] < minLat) minLat = coord[1];
      if (coord[1] > maxLat) maxLat = coord[1];
    }
  });

  if (minLng < maxLng && minLat < maxLat) {
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, duration: 1000 });
  }
}

let cachedMasterData = null;

// Data Loading
async function loadStreetData(level, regionId) {
  if (!mapLoaded) {
    // If called before load, wait
    return;
  }
  
  ortsteilNameEl.textContent = "Lade Daten...";
  
  try {
    let data;
    if (regionId === 'radius') {
      if (!cachedMasterData) {
        ortsteilNameEl.textContent = "Lade Master-Daten (einmalig)...";
        const resp = await fetch('./berlin_streets.geojson');
        cachedMasterData = await resp.json();
      }
      data = cachedMasterData;
    } else if (regionId !== 'custom') {
      const url = `./streets_${regionId}.geojson`;
      const resp = await fetch(url);
      data = await resp.json();
    }
    
    ortsteilNameEl.textContent = "Verarbeite Daten...";
    let filteredFeatures = [];
    if (regionId === 'custom') {
      if (appState.customGeojson) {
        filteredFeatures = appState.customGeojson.features || [];
      }
    } else {
      // Filter data by difficulty for other modes
      filteredFeatures = data.features.filter(f => f.properties.difficulty <= level);
      
      if (regionId === 'radius') {
        const centerPt = turf.point(appState.radiusMode.center);
        const circle = turf.circle(centerPt, appState.radiusMode.radiusKm, {units: 'kilometers'});
        
        // Update radius circle layer
        if (map.getSource('radius-circle')) {
          map.getSource('radius-circle').setData({
            type: 'FeatureCollection',
            features: [circle]
          });
        }
        
        // Filter streets. Fast distance check first, then exact intersection.
        filteredFeatures = filteredFeatures.filter(f => {
           const firstCoord = f.geometry.type === 'LineString' ? f.geometry.coordinates[0] : 
                             (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates[0][0] : null);
           if (!firstCoord) return false;
           
           const dist = turf.distance(centerPt, turf.point(firstCoord), {units: 'kilometers'});
           // Quick bounding check to save expensive booleanIntersects
           if (dist > appState.radiusMode.radiusKm + 2) return false;
           
           return turf.booleanIntersects(f, circle);
        });
      }
    }

    if (regionId !== 'radius' && map.getSource('radius-circle')) {
      // clear circle
      map.getSource('radius-circle').setData({ type: 'FeatureCollection', features: [] });
    }

    // Ensure every feature has a proper string ID for MapLibre feature states, and a fallback name
    filteredFeatures.forEach((f, i) => {
      f.id = f.id || f.properties.id || `feature_${Date.now()}_${i}`;
      if (!f.properties.name) f.properties.name = `Feature ${i+1}`;
    });

    currentGeojsonData = {
      type: "FeatureCollection",
      features: filteredFeatures
    };

    // Update map source
    map.getSource('streets').setData(currentGeojsonData);

    fitMapToBounds();
    switchMode(appState.mode);
  } catch (err) {
    console.error(err);
    ortsteilNameEl.textContent = "Error loading map data.";
    ortsteilNameEl.style.color = "#ef4444";
  }
}
