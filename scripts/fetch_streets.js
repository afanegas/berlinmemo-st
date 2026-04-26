import fetch from 'node-fetch';
import fs from 'fs';
import osmtogeojson from 'osmtogeojson';
import * as turf from '@turf/turf';

const regionIdMap = {
  "mitte": "Mitte",
  "friedrichshain_kreuzberg": "Friedrichshain-Kreuzberg",
  "pankow": "Pankow",
  "charlottenburg_wilmersdorf": "Charlottenburg-Wilmersdorf",
  "spandau": "Spandau",
  "steglitz_zehlendorf": "Steglitz-Zehlendorf",
  "tempelhof_schoeneberg": "Tempelhof-Schöneberg",
  "neukoelln": "Neukölln",
  "treptow_koepenick": "Treptow-Köpenick",
  "marzahn_hellersdorf": "Marzahn-Hellersdorf",
  "lichtenberg": "Lichtenberg",
  "reinickendorf": "Reinickendorf"
};

async function fetchStreets() {
  console.log("Fetching streets from Overpass...");
  const query = `
    [out:json][timeout:300];
    area["name"="Berlin"]["admin_level"="4"]->.searchArea;
    (
      way["highway"~"^(primary|secondary|tertiary|residential|living_street|unclassified|service|pedestrian)$"]["name"](area.searchArea);
    );
    out body;
    >;
    out skel qt;
  `;
  
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query
  });
  
  const osmData = await response.json();
  console.log("Converting to GeoJSON...");
  const geojson = osmtogeojson(osmData);
  
  console.log("Loading district boundaries...");
  const bezirkeData = JSON.parse(fs.readFileSync('./public/lor_ortsteile.geojson', 'utf-8'));
  
  console.log("Processing streets and assigning Bezirke...");
  
  const featuresByBezirk = {};
  Object.keys(regionIdMap).forEach(id => {
    featuresByBezirk[id] = [];
  });

  const getDifficulty = (highway) => {
    if (['primary', 'secondary', 'tertiary'].includes(highway)) return 1;
    if (['residential', 'living_street', 'unclassified', 'pedestrian'].includes(highway)) return 2;
    return 3;
  };

  for (const feature of geojson.features) {
    if (!feature.properties || !feature.properties.name) continue;
    
    const streetName = feature.properties.name;
    const highwayType = feature.properties.highway;
    
    let centerPt;
    try {
      if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        centerPt = turf.centroid(feature);
      } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
        centerPt = turf.center(feature);
      } else {
        continue;
      }
    } catch (e) {
      continue;
    }
    
    let assignedBezirkName = "Unknown";
    let assignedBezirkId = null;
    
    for (const bFeature of bezirkeData.features) {
      if (turf.booleanPointInPolygon(centerPt, bFeature)) {
        assignedBezirkName = bFeature.properties.BEZIRK;
        // Find the ID for this name
        assignedBezirkId = Object.keys(regionIdMap).find(id => regionIdMap[id] === assignedBezirkName);
        break;
      }
    }
    
    if (assignedBezirkId) {
      featuresByBezirk[assignedBezirkId].push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          name: streetName,
          highway: highwayType,
          difficulty: getDifficulty(highwayType),
          BEZIRK: assignedBezirkName,
          id: feature.id
        }
      });
    }
  }
  
  console.log("Saving individual Bezirk files...");
  for (const [id, features] of Object.entries(featuresByBezirk)) {
    const finalGeoJSON = {
      type: "FeatureCollection",
      features: features
    };
    fs.writeFileSync(`./public/streets_${id}.geojson`, JSON.stringify(finalGeoJSON));
    console.log(`Saved ${features.length} features to public/streets_${id}.geojson`);
  }
}

fetchStreets().catch(console.error);
