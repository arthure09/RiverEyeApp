/**
 * Algoritma deteksi "jalan banjir".
 * Mengelompokkan titik pantau menjadi ruas jalan, lalu menandai ruas yang
 * memiliki >= 2 titik pantau berstatus SIAGA (BAHAYA / sensor biner banjir).
 * Ruas seperti ini akan dioverlay merah di peta.
 */

const LINK_DISTANCE_M = 250; // dua titik <= jarak ini dianggap satu ruas jalan
const MIN_SIAGA_PER_ROAD = 2; // ambang minimum agar ruas ditandai banjir

export const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Union-Find sederhana untuk mengelompokkan titik menjadi ruas jalan.
const makeUF = (n) => {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };
  return { find, union };
};

const sameRoad = (a, b) => {
  // Prioritas: nama jalan dari admin. Jika tidak ada, pakai kedekatan jarak.
  if (a.road && b.road) return a.road.trim().toLowerCase() === b.road.trim().toLowerCase();
  return (
    haversine(
      a.coordinates.latitude,
      a.coordinates.longitude,
      b.coordinates.latitude,
      b.coordinates.longitude,
    ) <= LINK_DISTANCE_M
  );
};

// Urutkan titik mengikuti sumbu dominan agar garis overlay tidak zig-zag.
const orderAlongAxis = (nodes) => {
  const lats = nodes.map((n) => n.coordinates.latitude);
  const lons = nodes.map((n) => n.coordinates.longitude);
  const latSpread = Math.max(...lats) - Math.min(...lats);
  const lonSpread = Math.max(...lons) - Math.min(...lons);
  const axis = lonSpread >= latSpread ? 'longitude' : 'latitude';
  return [...nodes].sort((a, b) => a.coordinates[axis] - b.coordinates[axis]);
};

export const isSiaga = (node) => node?.status?.risk === 'BAHAYA';

/**
 * @returns {Array<{ key, name, nodes, path }>} daftar ruas jalan yang banjir
 *  - nodes: titik pantau siaga pada ruas tsb
 *  - path: koordinat terurut untuk menggambar overlay (perkiraan garis lurus)
 */
export const computeFloodedRoads = (nodes) => {
  if (!nodes || nodes.length < MIN_SIAGA_PER_ROAD) return [];

  const uf = makeUF(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (sameRoad(nodes[i], nodes[j])) uf.union(i, j);
    }
  }

  // Kumpulkan anggota tiap klaster
  const clusters = new Map();
  nodes.forEach((node, i) => {
    const root = uf.find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(node);
  });

  const flooded = [];
  for (const members of clusters.values()) {
    const siaga = members.filter(isSiaga);
    if (siaga.length >= MIN_SIAGA_PER_ROAD) {
      const ordered = orderAlongAxis(siaga);
      flooded.push({
        key: ordered.map((n) => n.id).join('-'),
        name: ordered.find((n) => n.road)?.road || 'Ruas jalan tergenang',
        nodes: ordered,
        path: ordered.map((n) => n.coordinates),
      });
    }
  }
  return flooded;
};
