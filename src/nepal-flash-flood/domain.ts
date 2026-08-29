export type DataClassification =
  | "observed"
  | "derived"
  | "simulated"
  | "estimated"
  | "representative"
  | "synthetic";

export type BreachMechanism =
  | "slow_overtopping"
  | "partial_breach"
  | "rapid_breach"
  | "catastrophic_breach";

export type AntecedentFlow = "low" | "normal" | "high" | "extreme";
export type ChannelRoughness = "low" | "normal" | "high";
export type BridgeCondition =
  | "existing"
  | "partially_blocked"
  | "fully_blocked"
  | "failed_open_channel";

export interface DataSource {
  id: string;
  name: string;
  provider: string;
  url: string;
  license: string;
  classification: DataClassification;
  limitations: string;
}

export interface ModelProvenance {
  classification: DataClassification;
  source: string;
  modelVersion: string;
  generationMethod: string;
  confidence: "low" | "medium" | "high";
  limitations: string[];
  dataSources: DataSource[];
}

export interface CalibrationStatus {
  label: string;
  status: "awaiting_observed_dataset" | "published_reference_only" | "validated" | "not_applicable";
  notes: string;
  iou?: number;
  precision?: number;
  recall?: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  scenarioType: "reference_event" | "barrier_lake_what_if";
  referenceReleaseMillionM3?: number;
  lakeVolumeMillionM3: number;
  breachMechanism: BreachMechanism;
  breachDurationMinutes: number;
  relativeBreachWidth: "small" | "medium" | "large" | "extreme";
  rainfallMultiplier: number;
  antecedentFlow: AntecedentFlow;
  debrisPercent: number;
  channelRoughness: ChannelRoughness;
  bridgeCondition: BridgeCondition;
  secondaryBlockage: boolean;
  provenance: ModelProvenance;
}

export interface SimulationFrame {
  timeMinutes: number;
  footprint: number[][];
  centerline: number[][];
  frontDistanceKm?: number;
  arrivalTimeByKm?: Array<[number, number]>;
  meanDepthM: number;
  maxDepthM: number;
  velocityMS: number;
  hazardIndex: number;
  classification: DataClassification;
}

export interface ReleaseHydrographPoint {
  timeMinutes: number;
  dischargeCMS: number;
}

export interface SimulationMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  classification: DataClassification;
}

export interface FloodRasterMetadata {
  scenarioId: string;
  resolutionM: number;
  horizontalDatum: string;
  verticalDatum: string;
  classification: DataClassification;
  notes: string;
}

export interface InfrastructureAsset {
  id: string;
  name: string;
  kind: "bridge" | "road" | "settlement" | "critical_facility";
  coordinates: number[];
  corridorKm: number;
  officialNameVerified: boolean;
  classification: DataClassification;
}

export interface AssetExposure {
  assetId: string;
  arrivalTimeMinutes: number | null;
  maxModeledDepthM: number;
  maxModeledVelocityMS: number;
  hazard: "none" | "low" | "moderate" | "high" | "very_high";
  exposure: "none" | "low" | "moderate" | "high";
  confidence: "low" | "medium" | "high";
  classification: DataClassification;
}

export interface SettlementExposure extends AssetExposure {
  potentiallyIsolated: boolean;
}

export interface SimulationRun {
  id: string;
  scenario: SimulationScenario;
  releaseHydrograph?: ReleaseHydrographPoint[];
  releasedVolumeM3?: number;
  hydrographMassErrorPercent?: number;
  frames: SimulationFrame[];
  metrics: SimulationMetric[];
  rasterMetadata: FloodRasterMetadata;
  assetExposure: AssetExposure[];
  provenance: ModelProvenance;
  approximation: boolean;
}

export interface ScenarioComparison {
  scenarioA: string;
  scenarioB: string;
  extentDeltaHa: number;
  arrivalDeltaMinutes: number;
  depthDeltaM: number;
  velocityDeltaMS: number;
  roadExposureDeltaKm: number;
  bridgeExposureDeltaCount: number;
  settlementExposureDeltaCount: number;
  classification: DataClassification;
}

export interface VerificationResult {
  label: string;
  status: "available" | "unavailable" | "not_integrated";
  metric?: string;
  value?: number;
  notes: string;
}

export interface MissionStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "failed";
  classification: DataClassification;
  elapsedMs?: number;
}

export interface MissionEvent {
  step: MissionStep;
  message: string;
}

export interface FloodSimulationEngine {
  runScenario(input: SimulationScenario): Promise<SimulationRun>;
}

export interface MissionExecutionProvider {
  execute(scenario: SimulationScenario): AsyncIterable<MissionEvent>;
}

export interface GeospatialAnalysisProvider {
  calculateExposure(run: SimulationRun, assets: InfrastructureAsset[]): Promise<AssetExposure[]>;
}
