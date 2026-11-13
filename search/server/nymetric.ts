export const NYMETRIC_GOAL =
  "Nymetric has no public API yet, so there are no tools to build.";

export type NymetricPackage = {
  service: "nymetric";
  goal: string;
  tools: [];
};

export function createNymetricPackage(): NymetricPackage {
  return { service: "nymetric", goal: NYMETRIC_GOAL, tools: [] };
}
