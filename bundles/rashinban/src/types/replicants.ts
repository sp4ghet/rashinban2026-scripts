// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.

export const REPLICANTS = {
  lowerThirdVisible: "lowerThirdVisible",
  round: "round",
} as const;

export interface ReplicantMap {
  [REPLICANTS.lowerThirdVisible]: boolean;
  [REPLICANTS.round]: number;
}
