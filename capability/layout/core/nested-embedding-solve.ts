import type { NestedSupportLedger } from '../contract/records/nested-support.js';
import { reject, required } from './nested-support-graph.js';

/** Longest paths on the admitted DAG, with grow-only floors; replay every inequality once.
 * Caller reconstruction is the recovery path. No input or committed scene is mutated.
 */
export function solveNestedEmbedding(ledger: NestedSupportLedger) {
  const positions = new Map(ledger.vertices.map((v) => [v.key, v.position]));
  const outgoing = new Map<string, (typeof ledger.constraints)[number][]>();
  ledger.constraints.forEach((edge) => {
    const group = outgoing.get(edge.from) ?? [];
    group.push(edge);
    outgoing.set(edge.from, group);
  });
  ledger.order.forEach((key) =>
    (outgoing.get(key) ?? []).forEach((edge) => {
      positions.set(
        edge.to,
        Math.max(required(positions, edge.to), required(positions, key) + edge.required),
      );
    }),
  );
  ledger.constraints.forEach((edge) => {
    const available = required(positions, edge.to) - required(positions, edge.from);
    if (available < edge.required)
      reject('cyclic-constraints', [edge.key, ...edge.provenance], [edge.required], [available]);
  });
  const old = new Map(
    ledger.vertices.flatMap((v) =>
      v.aliases.map((key) => [key, v.position + (v.aliasOffsets?.[key] ?? 0)] as const),
    ),
  );
  ledger.equalities.forEach((group) =>
    group.members.forEach((member) =>
      member.aliases.forEach((key) =>
        old.set(key, member.position + (member.aliasOffsets?.[key] ?? 0)),
      ),
    ),
  );
  const values = new Map(
    ledger.vertices.flatMap((v) =>
      v.aliases.map(
        (key) => [key, required(positions, v.key) + (v.aliasOffsets?.[key] ?? 0)] as const,
      ),
    ),
  );
  const moved = [...values]
    .filter(([key, value]) => value !== required(old, key))
    .map(([key, position]) => ({ key, before: required(old, key), position }));
  return { values, old, moved };
}
