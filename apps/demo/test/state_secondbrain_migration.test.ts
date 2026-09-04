import { describe, expect, it } from 'vitest'
import { kvSet } from '../src/db'
import { loadState, KEY } from '../src/state'

/**
 * Advisor-flagged (this branch): `secondBrainNote` (singular) was renamed to
 * `secondBrainNotes` (array) when scenario A's flat note was added alongside
 * the existing ladder note (DECISIONS.md, "Geologengasse merge" section). A
 * device that ran an EARLIER BUILD OF THIS BRANCH -- a rehearsal phone, not
 * a hypothetical -- has the old singular field on disk and no plural array
 * at all. Without a migration in `withDefaults`, `s.secondBrainNotes?.length`
 * reads falsy on such a device, main.ts's `isLeafAsker` silently flips true,
 * and the whole relay path goes dead with no error on screen -- exactly the
 * kind of pre-show failure this project's byte-level testing discipline
 * exists to catch before a live device hits it.
 *
 * Own file, not a second `it()` in state_defaults.test.ts: loadState()
 * memoizes into a module-level `cached` var, so a second call within the
 * same test file's module instance would just hand back the first call's
 * already-normalized object -- see that file's own comment. A separate file
 * gets its own fresh module instance from vitest.
 */
describe('loadState() migrates a pre-D26 secondBrainNote (singular) into secondBrainNotes (array)', () => {
  it('wraps the legacy singular note into a one-element array', async () => {
    const legacyNote = {
      id: 'note1',
      text: 'Der Jakob hat eine Leiter.',
      createdAt: new Date().toISOString(),
      ownerPeerId: 'jakob',
      ownerDisplayName: 'Jakob',
    }
    const legacy = {
      me: { id: 'a0000000', displayName: 'A (rehearsal build)' },
      threads: [],
      peers: [],
      secondBrainNote: legacyNote, // old singular field, no `secondBrainNotes` at all
    }
    await kvSet(KEY, legacy)

    const s = await loadState()
    expect(s).not.toBeNull()
    expect(s!.secondBrainNotes).toEqual([legacyNote])
    // the old field is not surfaced as a real part of DeviceState going
    // forward -- only the migrated array is what every reader now uses.
    expect((s as unknown as { secondBrainNote?: unknown }).secondBrainNote).toEqual(legacyNote)
  })
})
