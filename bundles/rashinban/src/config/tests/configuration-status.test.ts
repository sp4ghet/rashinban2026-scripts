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

test('a normalized projection received before save acknowledgement is rendered after success', () => {
  const draft = new ConfigurationDraft();
  let rendered = 'initial';
  draft.observeRevision('revision-one');
  draft.acceptProjection(() => { rendered = 'loaded'; });
  draft.markDirty();
  rendered = 'user input';

  draft.observeRevision('revision-two');
  draft.acceptProjection(() => { rendered = 'normalized'; });
  assert.equal(rendered, 'user input');

  draft.saved();
  assert.equal(rendered, 'normalized');
  assert.equal(draft.expectedRevision(), 'revision-two');
});

test('a normalized projection received after save acknowledgement is rendered immediately', () => {
  const draft = new ConfigurationDraft();
  let rendered = 'initial';
  draft.observeRevision('revision-one');
  draft.acceptProjection(() => { rendered = 'loaded'; });
  draft.markDirty();
  rendered = 'user input';

  draft.observeRevision('revision-two');
  draft.saved();
  assert.equal(rendered, 'user input');

  draft.acceptProjection(() => { rendered = 'normalized'; });
  assert.equal(rendered, 'normalized');
  assert.equal(draft.expectedRevision(), 'revision-two');
});

test('an ignored projection stays pending after a failed save', () => {
  const draft = new ConfigurationDraft();
  let rendered = 'loaded';
  draft.observeRevision('revision-one');
  draft.acceptProjection(() => { rendered = 'loaded'; });
  draft.markDirty();
  rendered = 'user input';

  draft.observeRevision('revision-two');
  draft.acceptProjection(() => { rendered = 'external value'; });

  assert.equal(rendered, 'user input');
  assert.equal(draft.isDirty(), true);
  assert.equal(draft.expectedRevision(), 'revision-one');
});

test('structural add and remove edits survive an external projection with their loaded revision', () => {
  const draft = new ConfigurationDraft();
  let stems = ['base', 'accent'];
  draft.observeRevision('revision-one');
  draft.acceptProjection(() => { stems = ['base', 'accent']; });

  draft.edit(() => { stems = stems.filter(stem => stem !== 'accent'); });
  draft.edit(() => { stems.push('urgent'); });

  draft.observeRevision('revision-two');
  draft.acceptProjection(() => { stems = ['external']; });

  assert.deepEqual(stems, ['base', 'urgent']);
  assert.equal(draft.isDirty(), true);
  assert.equal(draft.expectedRevision(), 'revision-one');
});
