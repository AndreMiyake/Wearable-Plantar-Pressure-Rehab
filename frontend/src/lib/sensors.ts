export const SENSOR_KEYS = ["fsr0", "fsr1", "fsr2", "fsr3", "fsr4", "fsr5", "fsr6"] as const;

export type SensorKey = (typeof SENSOR_KEYS)[number];

export type SensorCoord = { x: number; y: number };
export type SensorCoordMap = Record<SensorKey, SensorCoord>;

export const RAW_SENSOR_COORDS: SensorCoordMap = {
  fsr0: { x: 210, y: 50 },
  fsr1: { x: 300, y: 400 },
  fsr2: { x: 130, y: 100 },
  fsr3: { x: 350, y: 175 },
  fsr4: { x: 400, y: 400 },
  fsr5: { x: 50, y: 210 },
  fsr6: { x: 50, y: 300 },
};

export const IMAGE_SENSOR_COORDS: SensorCoordMap = {
  fsr0: { x: 160, y: 130 },
  fsr1: { x: 230, y: 140 },
  fsr2: { x: 175, y: 210 },
  fsr3: { x: 240, y: 225 },
  fsr4: { x: 190, y: 280 },
  fsr5: { x: 160, y: 350 },
  fsr6: { x: 220, y: 340 },
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
