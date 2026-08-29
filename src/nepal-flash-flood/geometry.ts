const EARTH_RADIUS_M = 6_371_008.8;

export function distanceKm(a: number[], b: number[]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad((b[1] ?? 0) - (a[1] ?? 0));
  const dLon = toRad((b[0] ?? 0) - (a[0] ?? 0));
  const lat1 = toRad(a[1] ?? 0);
  const lat2 = toRad(b[1] ?? 0);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return (2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}

function referenceLatRad(points: number[][]): number {
  const lat = points.reduce((sum, point) => sum + (point[1] ?? 0), 0) / Math.max(1, points.length);
  return (lat * Math.PI) / 180;
}

function project(point: number[], lat0: number): [number, number] {
  const lon = ((point[0] ?? 0) * Math.PI) / 180;
  const lat = ((point[1] ?? 0) * Math.PI) / 180;
  return [EARTH_RADIUS_M * lon * Math.cos(lat0), EARTH_RADIUS_M * lat];
}

export function polygonAreaHa(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const closed = ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring : [...ring, ring[0] ?? [0, 0]];
  const lat0 = referenceLatRad(closed);
  let sum = 0;
  for (let index = 0; index < closed.length - 1; index += 1) {
    const [x1, y1] = project(closed[index] ?? [0, 0], lat0);
    const [x2, y2] = project(closed[index + 1] ?? [0, 0], lat0);
    sum += x1 * y2 - x2 * y1;
  }
  return Number((Math.abs(sum) / 2 / 10_000).toFixed(2));
}

export function pointInPolygon(point: number[], polygon: number[][]): boolean {
  if (polygon.length < 3) return false;
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]?.[0] ?? 0;
    const yi = polygon[i]?.[1] ?? 0;
    const xj = polygon[j]?.[0] ?? 0;
    const yj = polygon[j]?.[1] ?? 0;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / Math.max(1e-12, yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function cumulativeKm(line: number[][]): number[] {
  const distances = [0];
  for (let index = 1; index < line.length; index += 1) {
    distances.push((distances.at(-1) ?? 0) + distanceKm(line[index - 1] ?? [0, 0], line[index] ?? [0, 0]));
  }
  return distances.map((value) => Number(value.toFixed(3)));
}

export function exposedLineLengthKm(line: number[][], polygon: number[][]): number {
  if (line.length < 2 || polygon.length < 3) return 0;
  let length = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1] ?? [0, 0];
    const b = line[index] ?? [0, 0];
    const midpoint = [(a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) / 2, (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) / 2];
    if (pointInPolygon(midpoint, polygon)) length += distanceKm(a, b);
  }
  return Number(length.toFixed(2));
}
