// editor.js
let mapLoaded = false;
let masterData = null; // To hold berlin_streets.geojson
let customFeatureCollection = { type: 'FeatureCollection', features: [] };
let activeMode = 'street'; // 'street', 'point', 'note'
let selectedFeatureForNote = null;

// DOM Elements
const btnDownload = document.getElementById('btn-download');
const uploadGeojson = document.getElementById('upload-geojson');

const modeStreet = document.getElementById('mode-street');
const modePoint = document.getElementById('mode-point');
const modeNote = document.getElementById('mode-note');

const toolStreet = document.getElementById('tool-street');
const toolPoint = document.getElementById('tool-point');
const toolNote = document.getElementById('tool-note');

const searchInput = document.getElementById('search-street-input');
const searchResults = document.getElementById('search-results');

const pointModal = document.getElementById('point-name-modal');
const modalPointNameInput = document.getElementById('modal-point-name-input');
const modalPointNoteInput = document.getElementById('modal-point-note-input');
const btnModalPointSave = document.getElementById('btn-modal-point-save');
const btnModalPointCancel = document.getElementById('btn-modal-point-cancel');

const btnNewMap = document.getElementById('btn-new-map');
const confirmModal = document.getElementById('confirm-modal');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');

let pendingPointData = null;

const noteEditor = document.getElementById('note-editor');
const noteTargetName = document.getElementById('note-target-name');
const noteInput = document.getElementById('note-input');
const btnSaveNote = document.getElementById('btn-save-note');

const featureCount = document.getElementById('feature-count');
const featureList = document.getElementById('feature-list');

// Initialize MapLibre Map
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'carto-light': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    },
    layers: [{
      id: 'carto-light-layer',
      type: 'raster',
      source: 'carto-light',
      minzoom: 0,
      maxzoom: 22
    }]
  },
  center: [13.4050, 52.5200],
  zoom: 11,
  attributionControl: false
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', async () => {
  mapLoaded = true;

  // Add source and layers for custom features
  map.addSource('custom-data', { type: 'geojson', data: customFeatureCollection, promoteId: 'id' });
  
  // Lines
  map.addLayer({
    id: 'custom-lines',
    type: 'line',
    source: 'custom-data',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    paint: {
      'line-color': '#10b981',
      'line-width': 4,
      'line-opacity': 0.8
    }
  });

  // Points
  map.addLayer({
    id: 'custom-points',
    type: 'circle',
    source: 'custom-data',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-color': '#f59e0b',
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Interaction for Note tool
  const interactiveLayers = ['custom-lines', 'custom-points'];
  interactiveLayers.forEach(layer => {
    map.on('mouseenter', layer, () => {
      if (activeMode === 'note') map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = activeMode === 'point' ? 'crosshair' : '';
    });
    map.on('click', layer, (e) => {
      if (activeMode === 'note') {
        const feature = e.features[0];
        selectFeatureForNote(feature.id);
      }
    });
  });

  // Map click for Point tool
  map.on('click', (e) => {
    if (activeMode === 'point') {
      pendingPointData = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      modalPointNameInput.value = '';
      modalPointNoteInput.value = '';
      pointModal.classList.remove('hidden');
      setTimeout(() => modalPointNameInput.focus(), 100);
    }
  });

  btnModalPointCancel.onclick = () => {
    pointModal.classList.add('hidden');
    pendingPointData = null;
  };

  btnModalPointSave.onclick = () => {
    if (!pendingPointData) return;
    const name = modalPointNameInput.value.trim();
    const note = modalPointNoteInput.value.trim();
    if (!name) {
      alert("Ein Name ist erforderlich. Der Punkt wurde nicht gespeichert.");
      return;
    }
    
    const pt = {
      type: 'Feature',
      id: 'point_' + Date.now(),
      geometry: {
        type: 'Point',
        coordinates: [pendingPointData.lng, pendingPointData.lat]
      },
      properties: {
        name: name,
        notes: note,
        id: 'point_' + Date.now(),
        difficulty: 1,
        BEZIRK: 'Custom'
      }
    };
    addFeature(pt);
    
    pointModal.classList.add('hidden');
    pendingPointData = null;
  };

  // Allow pressing Enter in the point name input
  modalPointNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnModalPointSave.click();
    } else if (e.key === 'Escape') {
      btnModalPointCancel.click();
    }
  });

  // Load master data for searching
  try {
    const res = await fetch('./berlin_streets.geojson');
    masterData = await res.json();
    // Pre-assign IDs
    masterData.features.forEach((f, i) => {
      f.id = f.properties.id || `master_${i}`;
      f.properties.id = f.id;
    });
  } catch(e) {
    console.error("Failed to load master data", e);
  }
});

// Update Map & List
function updateData() {
  if (mapLoaded) {
    map.getSource('custom-data').setData(customFeatureCollection);
  }
  
  // Save to localStorage for seamless transfer to main app
  localStorage.setItem('berlinmemo_custom_map', JSON.stringify(customFeatureCollection));
  
  featureCount.textContent = customFeatureCollection.features.length;
  featureList.innerHTML = '';
  
  customFeatureCollection.features.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'feature-item';
    
    const label = document.createElement('span');
    const typeIcon = f.geometry.type === 'Point' ? '📍' : '🛣️';
    let text = `${typeIcon} ${f.properties.name}`;
    if (f.properties.notes) text += ` <span style="color:#10b981;font-size:0.7rem;">(Notiz)</span>`;
    label.innerHTML = text;
    
    // Select for note
    label.style.cursor = 'pointer';
    label.onclick = () => {
      if(activeMode !== 'note') switchMode('note');
      selectFeatureForNote(f.id || f.properties.id);
    };

    const rmBtn = document.createElement('button');
    rmBtn.className = 'remove-btn';
    rmBtn.textContent = 'X';
    rmBtn.onclick = (e) => {
      e.stopPropagation();
      removeFeature(f.id || f.properties.id);
    };

    el.appendChild(label);
    el.appendChild(rmBtn);
    featureList.appendChild(el);
  });
}

function addFeature(feature) {
  // Check if already exists
  const exists = customFeatureCollection.features.find(f => (f.id === feature.id) || (f.properties.id === feature.properties.id));
  if (!exists) {
    customFeatureCollection.features.push(feature);
    updateData();
  }
}

function removeFeature(id) {
  customFeatureCollection.features = customFeatureCollection.features.filter(f => (f.id !== id) && (f.properties.id !== id));
  if (selectedFeatureForNote && (selectedFeatureForNote.id === id || selectedFeatureForNote.properties.id === id)) {
    selectedFeatureForNote = null;
    noteEditor.classList.add('hidden');
  }
  updateData();
}

function selectFeatureForNote(id) {
  const feature = customFeatureCollection.features.find(f => (f.id === id) || (f.properties.id === id));
  if (!feature) return;
  selectedFeatureForNote = feature;
  noteTargetName.value = feature.properties.name || '';
  noteInput.value = feature.properties.notes || '';
  noteEditor.classList.remove('hidden');
}

btnSaveNote.onclick = () => {
  if (selectedFeatureForNote) {
    const newName = noteTargetName.value.trim();
    if (newName === '') {
      alert("Der Name darf nicht leer sein.");
      return;
    }
    selectedFeatureForNote.properties.name = newName;
    selectedFeatureForNote.properties.notes = noteInput.value.trim();
    noteEditor.classList.add('hidden');
    selectedFeatureForNote = null;
    updateData(); // Refresh list to show note indicator and new name
  }
};

// Search Logic
searchInput.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  searchResults.innerHTML = '';
  if (q.length < 2 || !masterData) return;

  // Group by name to avoid showing 50 segments of the same street
  const uniqueMatches = new Map();
  masterData.features.forEach(f => {
    if (f.properties.name && f.properties.name.toLowerCase().includes(q)) {
      if (!uniqueMatches.has(f.properties.name)) {
        uniqueMatches.set(f.properties.name, {
          name: f.properties.name,
          bezirk: f.properties.BEZIRK || 'Unbekannt'
        });
      }
    }
  });

  const matches = Array.from(uniqueMatches.values()).slice(0, 50);
  
  matches.forEach(m => {
    const el = document.createElement('div');
    el.className = 'search-result-item';
    el.innerHTML = `<span>${m.name} <small style="opacity:0.6;">(${m.bezirk})</small></span> <span>+</span>`;
    el.onclick = () => {
      // Find all segments of this street in masterData
      const segments = masterData.features.filter(f => f.properties.name === m.name);
      if (segments.length === 0) return;
      
      let allCoords = [];
      segments.forEach(seg => {
        if (seg.geometry.type === 'LineString') {
          allCoords.push(seg.geometry.coordinates);
        } else if (seg.geometry.type === 'MultiLineString') {
          allCoords.push(...seg.geometry.coordinates);
        }
      });
      
      if (allCoords.length > 0) {
        const newFeature = {
          type: 'Feature',
          id: `merged_${Date.now()}`,
          geometry: {
            type: 'MultiLineString',
            coordinates: allCoords
          },
          properties: JSON.parse(JSON.stringify(segments[0].properties))
        };
        newFeature.properties.id = newFeature.id;
        addFeature(newFeature);
      }
    };
    searchResults.appendChild(el);
  });
});

// Mode Switching
function switchMode(mode) {
  activeMode = mode;
  modeStreet.classList.toggle('active', mode === 'street');
  modePoint.classList.toggle('active', mode === 'point');
  modeNote.classList.toggle('active', mode === 'note');

  toolStreet.classList.toggle('hidden', mode !== 'street');
  toolPoint.classList.toggle('hidden', mode !== 'point');
  toolNote.classList.toggle('hidden', mode !== 'note');
  
  if (mode === 'point') {
    map.getCanvas().style.cursor = 'crosshair';
  } else {
    map.getCanvas().style.cursor = '';
  }
  
  if (mode !== 'note') {
    noteEditor.classList.add('hidden');
    selectedFeatureForNote = null;
  }
}

modeStreet.onclick = () => switchMode('street');
modePoint.onclick = () => switchMode('point');
modeNote.onclick = () => switchMode('note');

// Neue Karte erstellen
btnNewMap.onclick = () => {
  confirmModal.classList.remove('hidden');
};

btnConfirmCancel.onclick = () => {
  confirmModal.classList.add('hidden');
};

btnConfirmOk.onclick = () => {
  customFeatureCollection = { type: 'FeatureCollection', features: [] };
  updateData();
  confirmModal.classList.add('hidden');
};

// IO
uploadGeojson.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.type === 'FeatureCollection') {
        // Ensure IDs
        data.features.forEach((f, i) => {
          f.id = f.id || f.properties.id || `imported_${Date.now()}_${i}`;
          f.properties.id = f.id;
        });
        customFeatureCollection = data;
        updateData();
        
        // Fit bounds
        let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
        customFeatureCollection.features.forEach(f => {
           if (f.geometry.type === 'Point') {
             minLng = Math.min(minLng, f.geometry.coordinates[0]); maxLng = Math.max(maxLng, f.geometry.coordinates[0]);
             minLat = Math.min(minLat, f.geometry.coordinates[1]); maxLat = Math.max(maxLat, f.geometry.coordinates[1]);
           } else if (f.geometry.coordinates && f.geometry.coordinates[0]) {
             const coord = f.geometry.type === 'LineString' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
             if(coord) {
               minLng = Math.min(minLng, coord[0]); maxLng = Math.max(maxLng, coord[0]);
               minLat = Math.min(minLat, coord[1]); maxLat = Math.max(maxLat, coord[1]);
             }
           }
        });
        if (minLng < maxLng && minLat < maxLat) {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50 });
        }
      } else {
        alert("Invalid GeoJSON FeatureCollection");
      }
    } catch(err) {
      alert("Error parsing JSON: " + err.message);
    }
  };
  reader.readAsText(file);
});

btnDownload.onclick = () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customFeatureCollection, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "custom_map.geojson");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};
