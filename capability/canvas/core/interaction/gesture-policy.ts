import type {
  GestureInput,
  GestureDecision,
  InteractionProfile,
} from '../../contract/records/profile.js';
/** Blank dragging defaults to pan; Shift explicitly starts marquee without changing saved tool. */
function selectGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  if (input.target === 'blank') return blankGesture(input, profile);
  return targetGesture(input, profile);
}
/** Threshold lookup distinguishes fine/coarse pointers without an extra conditional in selection policy. */
function targetGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  if (input.target === 'wire') return 'select';
  const thresholds = { fine: profile.fineThreshold, coarse: profile.coarseThreshold };
  return input.distance >= thresholds[input.pointer] ? 'move' : 'select';
}
/** Explicit tool actions are closed vocabulary; Select alone needs target/threshold interpretation. */
function toolGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  const fixed = { hand: 'pan', connect: 'connect' } as const;
  if (input.tool === 'select') return selectGesture(input, profile);
  return fixed[input.tool];
}
/** Middle button and Space temporarily pan; context-menu button does not initiate a canvas gesture. */
function pointerGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  if (input.button === 'secondary') return 'ignore';
  return panGesture(input, profile);
}
/** Pan modifiers take precedence over the selected tool and preserve it on release. */
function panGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  const requested = input.button === 'middle' || input.space;
  if (requested) return 'pan';
  return toolGesture(input, profile);
}
/** Interactive children and typing retain native behavior; public caller owns event propagation and recovery. */
export function decideGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  if (input.typing || input.interactive) return 'ignore';
  return pointerGesture(input, profile);
}

/** Shift is a temporary marquee modifier for the blank canvas. */
function blankGesture(
  input: GestureInput,
  profile: InteractionProfile,
): GestureDecision {
  return input.shift ? 'marquee' : profile.blankDrag;
}
