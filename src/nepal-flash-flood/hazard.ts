export function hazardIndex(depthM: number, velocityMS: number): number {
  return Number((Math.max(0, depthM) * Math.max(0, velocityMS)).toFixed(2));
}

export function classifyHazard(index: number): "none" | "low" | "moderate" | "high" | "very_high" {
  if (index <= 0.05) return "none";
  if (index < 0.8) return "low";
  if (index < 2.0) return "moderate";
  if (index < 4.0) return "high";
  return "very_high";
}

export function classifyExposure(depthM: number, hazard: string): "none" | "low" | "moderate" | "high" {
  if (depthM <= 0.05 || hazard === "none") return "none";
  if (depthM < 0.6) return "low";
  if (depthM < 1.8 && hazard !== "very_high") return "moderate";
  return "high";
}
