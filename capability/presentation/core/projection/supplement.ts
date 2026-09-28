import type { Dependencies, SupplementalMeasurements } from '../../contract/types.js';
import type { Section, SequenceItem } from '../../contract/records/input.js';
import type { ContentContext } from '../content/blocks.js';
import { resolvedStyle } from '../../contract/records/style.js';
import { parse, clone, requireValue, reject } from '../validation/outcomes.js';
import { labelContent } from '../content/headings.js';
import { markerMeasurements } from '../notation/markers.js';
/** Ordinary events have no branch headings; every declared fragment branch is measured exactly once. */
function branchHeadings(
  section: Section,
  item: SequenceItem,
  context: ContentContext,
): SupplementalMeasurements['branchHeadings'] {
  if (item.kind === 'event') return [];
  return item.branches.map((branch) => ({
    section: section.id,
    fragment: item.id,
    branch: branch.id,
    content: labelContent(branch.label, context, 'annotation'),
  }));
}
/** Measure the remaining routing/sequence vocabulary; caller restores missing pinned resources on failure. */
export function supplement(
  input: unknown,
  deps: Dependencies,
): SupplementalMeasurements {
  const collection = requireValue(deps.domain.read(clone(input)));
  const style = parse(resolvedStyle, requireValue(deps.themes.resolve(collection.theme)));
  if (`sha256:${style.digest}` !== collection.theme.digest)
    return reject(
      'missing-resource',
      'theme',
      'Resolved theme digest does not match the pinned theme',
    );
  const context = {
    collection,
    style,
    width: style.contentSizing.widths.medium.preferred,
    metrics: deps.measurement,
    assets: deps.assets,
  };
  return {
    version: `${deps.measurement.version}/markers-1`,
    markers: markerMeasurements(),
    branchHeadings: collection.sections.flatMap((section) =>
      section.sequence.flatMap((item) => branchHeadings(section, item, context)),
    ),
  };
}
