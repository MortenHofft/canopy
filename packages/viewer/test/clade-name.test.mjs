// internalName (the viewer's copy of the support-stripping rule) must agree with @gbif-phylo/io's splitInternalLabel on a fixed corpus.
// io is a devDependency of the viewer, used here only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { internalName } = await import('../src/clade-name.ts');
const { splitInternalLabel } = await import('@gbif-phylo/io');

const CORPUS = [
  '',
  '  ',
  '95',
  '0.95',
  '1e-3',
  '.5',
  '5.',
  '+3',
  '-1',
  ' 95 ',
  '98.0:c__Nitrososphaeria',
  '95:Chelodina_ott235768',
  '95:',
  '95: Foo',
  '95:Foo:Bar',
  ':Foo',
  '1:2',
  "'95'",
  'Chelodina',
  'Chelodina_ott235768',
  '16S_clade',
  '1_ott123',
  'mrcaott99343ott3606205',
  'Infinity',
  'NaN',
  '0x10',
  '1e',
  'e5',
  '95 : Foo',
  '1,000',
  '100/95',
  '95%',
];

test('internalName agrees with io splitInternalLabel(...).name over a fixed corpus', () => {
  for (const s of CORPUS) assert.equal(internalName(s), splitInternalLabel(s).name, JSON.stringify(s));
});

test('internalName: support values are no name, "support:name" is the name, and "100/95" and "95%" are names', () => {
  assert.equal(internalName('95'), '');
  assert.equal(internalName('98.0:c__Nitrososphaeria'), 'c__Nitrososphaeria');
  assert.equal(internalName('100/95'), '100/95');
  assert.equal(internalName('95%'), '95%');
});
