export const SENSOR_KEYS = ["fsr1", "fsr2", "fsr3", "fsr4"] as const;

export type SensorKey = (typeof SENSOR_KEYS)[number];

export type SensorCoord = { x: number; y: number };
export type SensorCoordMap = Record<SensorKey, SensorCoord>;

export const RAW_SENSOR_COORDS: SensorCoordMap = {
  fsr1: { x: 20, y: 10 }, // dedao do pe (mais para a esquerda)
  fsr2: { x: 50, y: 90 }, // calcanhar
  fsr3: { x: 35, y: 30 }, // cabeca distal do primeiro metatarso (um pouco para a esquerda)
  fsr4: { x: 70, y: 55 }, // medio pe (lateral)
};

export const IMAGE_SENSOR_COORDS: SensorCoordMap = {
  fsr1: { x: 170, y: 95 },
  fsr2: { x: 215, y: 365 },
  fsr3: { x: 185, y: 165 },
  fsr4: { x: 255, y: 245 },
};

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function computeBounds(coords: SensorCoordMap): Bounds {
  const values = Object.values(coords);
  if (!values.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...values.map((coord) => coord.x)),
    maxX: Math.max(...values.map((coord) => coord.x)),
    minY: Math.min(...values.map((coord) => coord.y)),
    maxY: Math.max(...values.map((coord) => coord.y)),
  };
}

export function normalizeSensorCoords(
  rawCoords: SensorCoordMap,
  targetCoords: SensorCoordMap = IMAGE_SENSOR_COORDS,
): SensorCoordMap {
  const rawBounds = computeBounds(rawCoords);
  const targetBounds = computeBounds(targetCoords);

  const rawSpanX = Math.max(rawBounds.maxX - rawBounds.minX, 1);
  const rawSpanY = Math.max(rawBounds.maxY - rawBounds.minY, 1);
  const targetSpanX = Math.max(targetBounds.maxX - targetBounds.minX, 1);
  const targetSpanY = Math.max(targetBounds.maxY - targetBounds.minY, 1);

  const normalized = {} as SensorCoordMap;
  for (const key of SENSOR_KEYS) {
    const coord = rawCoords[key];
    normalized[key] = {
      x: targetBounds.minX + ((coord.x - rawBounds.minX) / rawSpanX) * targetSpanX,
      y: targetBounds.minY + ((coord.y - rawBounds.minY) / rawSpanY) * targetSpanY,
    };
  }

  return normalized;
}

export const SENSOR_COORDS = normalizeSensorCoords(RAW_SENSOR_COORDS);
