import type { ComponentType, ReactElement } from 'react';
import type { FeatureProps, DesignSlots } from '../../contract/react-types.js';
import styles from './MovementReview.module.css';

type MovementDocument = NonNullable<FeatureProps['view']['movementReview']>['document'];
type MovementTarget = { kind: string; id: string; section?: string };

function labelFor(
  document: MovementDocument,
  target: MovementTarget,
): string {
  if (target.kind === 'section') return sectionLabel(document, target);
  return nodeLabel(document, target);
}
function sectionLabel(
  document: MovementDocument,
  target: MovementTarget,
): string {
  return (
    document.collection.sections.find((section) => section.id === target.id)?.title ?? target.id
  );
}
function nodeLabel(
  document: MovementDocument,
  target: MovementTarget,
): string {
  const section = document.scene.sections.find((item) => item.id === target.section);
  return section?.nodes.find((node) => node.id === target.id)?.measured.label ?? target.id;
}
function deltaText(
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
): string {
  const dx = Math.round(after.x - before.x);
  const dy = Math.round(after.y - before.y);
  const dw = Math.round(after.width - before.width);
  const dh = Math.round(after.height - before.height);
  const parts = [
    deltaPart('x', dx),
    deltaPart('y', dy),
    deltaPart('width', dw),
    deltaPart('height', dh),
  ].filter(Boolean);
  return parts.join(', ') || 'unchanged';
}
function deltaPart(
  label: string,
  value: number,
): string {
  if (value === 0) return '';
  return `${label} ${signedValue(value)}`;
}
function signedValue(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function createMovementReview({
  Button,
}: Pick<DesignSlots, 'Button'>): ComponentType<FeatureProps> {
  function MovementReview(props: FeatureProps): ReactElement | null {
    return renderMovementReview(Button, props);
  }
  return MovementReview;
}
function renderMovementReview(
  Button: DesignSlots['Button'],
  { controller, view }: FeatureProps,
): ReactElement | null {
  const review = view.movementReview;
  if (review === null) return null;
  return renderMovementContent(Button, controller, review);
}
function renderMovementContent(
  Button: DesignSlots['Button'],
  controller: FeatureProps['controller'],
  review: NonNullable<FeatureProps['view']['movementReview']>,
): ReactElement | null {
  const option = selectedOption(review);
  if (option === undefined) return null;
  const waiting = ['sending', 'uncertain'].includes(review.phase);
  const canApply = review.phase === 'review';
  return (
    <aside className={styles.review} aria-label="Movement review">
      <div className={styles.options} aria-label="Movement options">
        {review.review.options.map((candidate) => (
          <Button
            key={candidate.id}
            label={candidate.label}
            selected={candidate.id === review.optionId}
            disabled={waiting}
            onClick={() => controller.chooseMoveOption(candidate.id)}
          />
        ))}
      </div>
      <div className={styles.header}>
        <div>
          <strong>{option.label}</strong>
          <p>{phaseMessage(review.phase)}</p>
        </div>
        <span className={styles.count}>{option.geometryChanges.length} changes</span>
      </div>
      <ChangeList document={review.document} option={option} />
      <div className={styles.actions}>
        <Button label="Cancel" disabled={waiting} onClick={() => controller.cancelMove()} />
        <Button
          label={waiting ? 'Saving…' : 'Apply preview'}
          variant="primary"
          pending={waiting}
          disabled={!canApply}
          onClick={() => void controller.applyMove(option.id)}
        />
      </div>
    </aside>
  );
}
function selectedOption(
  review: NonNullable<FeatureProps['view']['movementReview']>,
): NonNullable<FeatureProps['view']['movementReview']>['review']['options'][number] | undefined {
  return review.review.options.find((item) => item.id === review.optionId);
}
function ChangeList({
  document,
  option,
}: {
  document: MovementDocument;
  option: NonNullable<FeatureProps['view']['movementReview']>['review']['options'][number];
}): ReactElement {
  return (
    <ul className={styles.changes} aria-label="Changed geometry">
      {option.geometryChanges.map((change) => {
        const target = change.target as MovementTarget;
        const resized = isResized(change.before, change.after);
        return (
          <li key={`${target.kind}:${target.section ?? ''}:${target.id}`}>
            <strong>{labelFor(document, target)}</strong>
            <span>
              {resized ? 'Container resized' : 'Moved'} · {deltaText(change.before, change.after)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
function phaseMessage(phase: 'review' | 'sending' | 'uncertain' | 'rejected'): string {
  return {
    sending: 'Saving this exact preview…',
    uncertain: 'Confirmation is pending. Keep this review open and check recovery.',
    rejected: 'The request was rejected. Cancel to discard this retained draft.',
    review: 'Inspect the complete preview before applying.',
  }[phase];
}
function isResized(
  before: { width: number; height: number },
  after: { width: number; height: number },
): boolean {
  return before.width !== after.width || before.height !== after.height;
}
