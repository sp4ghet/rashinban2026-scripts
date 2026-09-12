import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationDraft } from '../../dashboard/configuration-status.ts';

test('a dirty dashboard draft retains the revision of the values it loaded', () => {
  const draft = new ConfigurationDraft();
  draft.observeRevision('revision-one');
  draft.loaded();
  draft.markDirty();
  draft.observeRevision('revision-two');
  assert.equal(draft.expectedRevision(), 'revision-one');

  draft.saved();
  assert.equal(draft.expectedRevision(), 'revision-two');
});

test('a clean projection loaded before status adopts the first observed revision', () => {
  const draft = new ConfigurationDraft();
  draft.loaded();
  draft.observeRevision('revision-one');
  assert.equal(draft.expectedRevision(), 'revision-one');
});
