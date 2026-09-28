/*
 * Prepared import: a bundle imports into a new collection namespace with its semantic references
 * and human placement and route locks intact, and invalid manual targets, semantic source or an
 * owner rejection give no prepared candidate.
 */
import { describe, it, expect } from 'vitest';
import { createExport } from '../contract/index.js';
import { fixture, value, bundle, encoding, failed } from './fixtures.js';

describe('Prepared import isolation', /** The import namespace and rejection tests. */ () => {
  /**
   * Importing the fixture bundle as `copy` gives the same collection with ID `copy` and revision
   * 0, keeping the wire's sides, lock and bend points; the source snapshot stays at revision 7.
   * A bundle extended with an ER section and a sequence section imports as `mixed` with the
   * foreign-key reference and the sequence event intact. Importing into the source's own ID
   * (`engineering`) fails with `invalid-import`.
   */
  async function retainsReferencesAndLocks(): Promise<void> {
    // Act and check: import the bundle into a new namespace.
    const f = await fixture();
    const artifact = value(await f.bindings.service.exportArtifact(f.request('bundle')));
    const imported = value(
      await f.bindings.service.prepareImport({ bytes: artifact.bytes, targetCollectionId: 'copy' }),
    );
    expect(imported.expected).toBe('absent');
    expect(imported.collection).toEqual({ ...f.snapshot.collection, id: 'copy', revision: 0 });
    expect(imported.collection.sections[0]?.wires[0]).toMatchObject({
      sourceSide: 'right',
      targetSide: 'left',
      locked: true,
      manual: [
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ],
    });
    expect(f.snapshot.collection.revision).toBe(7);

    // Arrange: add an ER section and a sequence section to the bundle, with fresh digests.
    const semantic = bundle(artifact.bytes);
    const extra =
      'node @customer entity "Customer" {field @id "id" type="Id" key=primary}\n' +
      'node @order entity "Order" {field @customer "customer" type="Id" key=foreign ' +
      'references=@customer.@id}\n' +
      'wire @owns @customer.@id -> @order.@customer "owns" kind=association from=1 to=0..many\n' +
      'section @data "ER tables" mode=er {show @customer @order connect @owns}\n' +
      'node @human participant "Human" {} node @agent participant "Agent" {}\n' +
      'section @exchange "Sequence" mode=sequence {show @human @agent ' +
      'event @request @human -> @agent "Request" kind=call activate=true}\n';
    const source = semantic.source.slice(0, semantic.source.lastIndexOf('}')) + extra + '}';
    const manual = {
      ...semantic.manual,
      sections: [
        ...semantic.manual.sections,
        {
          id: 'data',
          appearanceOrder: ['customer', 'order'],
          groupOrder: [],
          sequenceOrder: [],
          appearances: [],
          groups: [],
          wires: [],
        },
        {
          id: 'exchange',
          appearanceOrder: ['human', 'agent'],
          groupOrder: [],
          sequenceOrder: [{ id: 'request', order: 0 }],
          appearances: [],
          groups: [],
          wires: [],
        },
      ],
    };
    const transfer = {
      ...semantic,
      source,
      sourceDigest: encoding.hash(encoding.utf8(source)),
      manual,
      manualDigest: canonicalDigest(manual),
    };

    // Act and check: the extended bundle keeps its references and sequence event.
    const mixed = value(
      await f.bindings.service.prepareImport({
        bytes: encoding.utf8(JSON.stringify(transfer)),
        targetCollectionId: 'mixed',
      }),
    );
    expect(
      mixed.collection.objects.find(/** Whether this is `order`. */ (item) => item.id === 'order')
        ?.content[0],
    ).toMatchObject({
      kind: 'field',
      key: 'foreign',
      references: { object: 'customer', member: 'id' },
    });
    expect(
      mixed.collection.sections.find(
        /** Whether this is `exchange`. */ (item) => item.id === 'exchange',
      )?.sequence[0],
    ).toMatchObject({ id: 'request', source: 'human', target: 'agent', activate: true, order: 0 });

    // Check: importing into the source's own ID.
    expect(
      await f.bindings.service.prepareImport({
        bytes: artifact.bytes,
        targetCollectionId: 'engineering',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-import' } });
  }

  it(
    '10 new namespace retains exact semantic references and human placement/route locks',
    retainsReferencesAndLocks,
  );

  /**
   * In order: duplicate manual sections fail with `invalid-import`; 33 manual sections fail with
   * `invalid-bundle`; a missing theme preset fails with `resource-rejected`; a document parser
   * that fails and a resource owner that rejects both give a failure. Exporting the bundle again
   * gives the same bytes, so none of this changed the source.
   */
  async function rejectsInvalidImports(): Promise<void> {
    // Arrange: the fixture bundle and its first manual section.
    const f = await fixture();
    const artifact = value(await f.bindings.service.exportArtifact(f.request('bundle')));
    const manifest = bundle(artifact.bytes);
    const section = manifest.manual.sections[0];
    expect(section).toBeDefined();
    if (!section) return;

    // Check: duplicate manual sections.
    const duplicatedManual = {
      ...manifest.manual,
      sections: [...manifest.manual.sections, ...manifest.manual.sections],
    };
    const altered = {
      ...manifest,
      manual: duplicatedManual,
      manualDigest: canonicalDigest(duplicatedManual),
    };
    expect(
      await f.bindings.service.prepareImport({
        bytes: encoding.utf8(JSON.stringify(altered)),
        targetCollectionId: 'copy',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-import' } });

    // Check: 33 manual sections.
    const oversizedManual = {
      ...manifest.manual,
      sections: Array.from(
        { length: 33 },
        /** A copy of the section with a numbered ID. */
        (_, index) => ({
          ...section,
          id: `section-${index}`,
        }),
      ),
    };
    const oversized = {
      ...manifest,
      manual: oversizedManual,
      manualDigest: canonicalDigest(oversizedManual),
    };
    expect(
      await f.bindings.service.prepareImport({
        bytes: encoding.utf8(JSON.stringify(oversized)),
        targetCollectionId: 'copy',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-bundle' } });

    // Check: the theme preset resource removed.
    const missingResource = {
      ...manifest,
      resources: manifest.resources.filter(
        /** Whether the resource is not the theme preset. */ (item) => item.kind !== 'preset',
      ),
    };
    expect(
      await f.bindings.service.prepareImport({
        bytes: encoding.utf8(JSON.stringify(missingResource)),
        targetCollectionId: 'copy',
      }),
    ).toMatchObject({ ok: false, error: { code: 'resource-rejected' } });

    // Check: a failing parser, then a rejecting resource owner.
    const noParse = createExport({
      ...f.bindings.dependencies,
      documents: {
        ...f.bindings.dependencies.documents,
        parse: /** Always fails. */ () => failed(),
      },
    });
    expect(
      (await noParse.prepareImport({ bytes: artifact.bytes, targetCollectionId: 'copy' })).ok,
    ).toBe(false);
    const denied = createExport({
      ...f.bindings.dependencies,
      resources: {
        inspect: /** Always rejects. */ async () => failed('resource-rejected'),
      },
    });
    expect(
      (await denied.prepareImport({ bytes: artifact.bytes, targetCollectionId: 'copy' })).ok,
    ).toBe(false);

    // Check: the source still exports the same bundle.
    expect(artifact.bytes).toEqual(
      value(await f.bindings.service.exportArtifact(f.request('bundle'))).bytes,
    );
  }

  it(
    '11 invalid manual targets, semantic source and owner rejection expose no prepared candidate',
    rejectsInvalidImports,
  );
});

/**
 * The digest the bundle format declares for a manual record: the SHA-256 of its canonical JSON
 * (each object's keys sorted), computed independently of Export's code.
 */
function canonicalDigest(manual: unknown): string {
  const canonical = JSON.stringify(
    manual,
    /** Each object with its keys sorted. */ (_, item) => sortObject(item),
  );
  return encoding.hash(encoding.utf8(canonical));
}

/**
 * An object with its own keys sorted, for building canonical JSON the way the bundle format
 * declares it, independently of Export's code. Arrays and other values are returned unchanged;
 * nested objects are sorted when `JSON.stringify` reaches them.
 */
function sortObject(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).sort(/** Orders entries by key. */ ([a], [b]) => a.localeCompare(b)),
  );
}
