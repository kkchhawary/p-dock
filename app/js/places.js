// Jagah wale reminder: "Delhi jaaun to yaad dilana".
// Aapki location sirf phone ke andar match hoti hai — kisi server ko nahi bheji jaati.

// Bade shehar (lat, lon). AI na ho tab bhi naam se jagah mil jaaye.
export const CITIES = {
  delhi: [28.6139, 77.209], 'new delhi': [28.6139, 77.209], noida: [28.5355, 77.391], gurgaon: [28.4595, 77.0266], gurugram: [28.4595, 77.0266],
  mumbai: [19.076, 72.8777], pune: [18.5204, 73.8567], bangalore: [12.9716, 77.5946], bengaluru: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707], hyderabad: [17.385, 78.4867], kolkata: [22.5726, 88.3639], ahmedabad: [23.0225, 72.5714],
  jaipur: [26.9124, 75.7873], jodhpur: [26.2389, 73.0243], udaipur: [24.5854, 73.7125], ajmer: [26.4499, 74.6399],
  kota: [25.2138, 75.8648], bikaner: [28.0229, 73.3119], 'mount abu': [24.5926, 72.7156], pushkar: [26.4897, 74.5511],
  agra: [27.1767, 78.0081], mathura: [27.4924, 77.6737], vrindavan: [27.5806, 77.7006], lucknow: [26.8467, 80.9462],
  varanasi: [25.3176, 82.9739], kanpur: [26.4499, 80.3319], prayagraj: [25.4358, 81.8463], ayodhya: [26.7922, 82.1998],
  chandigarh: [30.7333, 76.7794], amritsar: [31.634, 74.8723], shimla: [31.1048, 77.1734], manali: [32.2432, 77.1892],
  dehradun: [30.3165, 78.0322], rishikesh: [30.0869, 78.2676], haridwar: [29.9457, 78.1642], nainital: [29.3919, 79.4542],
  goa: [15.2993, 74.124], surat: [21.1702, 72.8311], vadodara: [22.3072, 73.1812], indore: [22.7196, 75.8577],
  bhopal: [23.2599, 77.4126], ujjain: [23.1765, 75.7885], nagpur: [21.1458, 79.0882], patna: [25.5941, 85.1376],
  kochi: [9.9312, 76.2673], trivandrum: [8.5241, 76.9366], mysore: [12.2958, 76.6394], ooty: [11.4102, 76.695],
  srinagar: [34.0837, 74.7973], leh: [34.1526, 77.5771], guwahati: [26.1445, 91.7362], darjeeling: [27.041, 88.2663],
  bhubaneswar: [20.2961, 85.8245], puri: [19.8135, 85.8312], raipur: [21.2514, 81.6296], ranchi: [23.3441, 85.3096],
  'khatu shyam': [27.3633, 75.4013], salasar: [27.7206, 74.7128], sikar: [27.6094, 75.1399], alwar: [27.553, 76.6346],
};

export function cityCoords(name) {
  const key = String(name || '').trim().toLowerCase();
  if (CITIES[key]) return CITIES[key];
  const hit = Object.keys(CITIES).find((c) => key.includes(c));
  return hit ? CITIES[hit] : null;
}

// AI se aayi jagah ya naam se shehar → {name, lat, lon, radius_km} ya null
export function resolvePlace(place) {
  if (!place?.name) return null;
  let { lat, lon } = place;
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  if (!valid) [lat, lon] = cityCoords(place.name) || [null, null];
  if (lat == null) return { name: place.name, lat: null, lon: null, radius_km: 25 };
  return { name: place.name, lat, lon, radius_km: Number(place.radius_km) > 0 ? Math.min(Number(place.radius_km), 200) : 25 };
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Abhi jahan ho, wahan ke pending reminders
export function remindersNear(reminders, here) {
  return reminders.filter((r) => !r.done && r.place?.lat != null && distanceKm(here, r.place) <= (r.place.radius_km || 25));
}

// Phone se location (permission maangta hai). Sirf yahin use hoti hai.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location support nahi hai'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Location ki permission nahi mili')),
      { maximumAge: 10 * 60 * 1000, timeout: 15000, enableHighAccuracy: false },
    );
  });
}
