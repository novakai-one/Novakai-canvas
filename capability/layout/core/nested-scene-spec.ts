import type {
  NestedSceneSpec,
  NestedSectionSpec as SectionSpec,
  NestedNodeSpec as NodeSpec,
} from '../contract/records/nested-scene-spec.js';
const sections: readonly SectionSpec[] = [
  {
    number: 1,
    nodes: nodeSpecs(1, 4),
    children: [{ number: 2, nodes: nodeSpecs(5, 6), children: [] }],
  },
  { number: 3, nodes: nodeSpecs(11, 6), children: [] },
  { number: 4, nodes: nodeSpecs(17, 6), children: [] },
];
function nodeSpecs(
  first: number,
  count: number,
): readonly NodeSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    number: first + i,
    label: `Node ${first + i}`,
  }));
}
const requests = [
  [1, 2],
  [1, 3],
  [2, 4],
  [5, 6],
  [6, 9],
  [8, 10],
  [11, 13],
  [17, 20],
  [4, 5],
  [10, 18],
  [16, 17],
  [12, 7],
  [5, 7],
  [11, 12],
  [1, 4],
  [9, 17],
  [16, 18],
  [12, 8],
] as const;
/** M3 remains the default semantic scene. */
export const defaultNestedSceneSpec: NestedSceneSpec = { sections, requests };
/** Opt-in concentration fixture; every addition is ordinary semantic scene data. */
export const fanInHubSceneSpec: NestedSceneSpec = {
  sections: sections.map((section) =>
    section.number === 1
      ? {
          ...section,
          nodes: [
            ...section.nodes,
            { number: 23, label: 'index.ts' },
            { number: 24, label: 'api.ts' },
          ],
        }
      : section,
  ),
  requests: [
    ...requests,
    [2, 23],
    [4, 23],
    [7, 23],
    [10, 23],
    [13, 23],
    [19, 23],
    [24, 8],
    [24, 20],
  ],
};
