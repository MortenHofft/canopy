// parsePhyloXml: hand-written documents for each feature and each way a file can be wrong, and real files (data/rich, the
// Biopython examples in test/fixtures/phyloxml) with the numbers of independent readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parsePhyloXml, toNewick } from '../src/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../../../data');
const read = (f) => {
  const b = fs.readFileSync(f);
  return (f.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8');
};
const doc = (body, attrs = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<phyloxml xmlns="http://www.phyloxml.org">\n<phylogeny rooted="true"${attrs}>${body}</phylogeny>\n</phyloxml>`;

test('clades, names and branch lengths as attribute or element', () => {
  const r = parsePhyloXml(
    doc(
      `<name>t1</name><clade><clade branch_length="0.5"><name>A</name></clade><clade><name>B</name><branch_length>0.25</branch_length></clade><clade/></clade>`,
    ),
  );
  assert.equal(toNewick(r.tree), '(A:0.5,B:0.25,);');
  assert.equal(r.treeName, 't1');
  assert.equal(r.rooted, true);
  assert.equal(r.treeCount, 1);
  assert.equal(r.tree.tipCount, 3);
  assert.deepEqual(r.tree.warnings, []);
});

test('support comes from the first numeric confidence; every confidence is an annotation by type', () => {
  const r = parsePhyloXml(
    doc(
      `<clade><confidence type="bootstrap">95</confidence><confidence type="probability">0.9</confidence><clade><name>A</name></clade><clade><name>B</name></clade></clade>`,
    ),
    { annotations: true },
  );
  assert.equal(r.tree.support[0], 95);
  assert.equal(r.tree.annotations.get(0, 'confidence.bootstrap'), 95);
  assert.equal(r.tree.annotations.get(0, 'confidence.probability'), 0.9);
  assert.ok(Number.isNaN(r.tree.support[1]));
});

test('taxonomy, sequence, events, colour, properties and ids are annotations, and the tip label chain', () => {
  const body = `<clade id_source="c0"><clade><name>g1</name>
    <taxonomy><id provider="NCBI">9606</id><code>HUMAN</code><scientific_name>Homo sapiens</scientific_name><common_name>human</common_name><rank>species</rank></taxonomy>
    <sequence><accession source="UniProt">P12345</accession><name>Protein one</name><symbol>P1</symbol><location>chr1</location></sequence>
    <events><type>speciation</type><duplications>2</duplications><speciations>3</speciations></events>
    <color><red>10</red><green>20</green><blue>30</blue></color><width>2.5</width><node_id>n1</node_id>
    <property ref="x:size" datatype="xsd:int" applies_to="clade">42</property></clade>
    <clade><taxonomy><scientific_name>Pan troglodytes</scientific_name></taxonomy></clade>
    <clade><taxonomy><code>GORGO</code></taxonomy></clade>
    <clade><sequence><accession>Q9</accession></sequence></clade></clade>`;
  const a = parsePhyloXml(doc(body), { annotations: true });
  assert.deepEqual(a.tree.tipLabels, ['g1', 'Pan troglodytes', 'GORGO', 'Q9']);
  const tip = a.tree.tipNode[0];
  const rec = a.tree.annotations.node.get(tip);
  assert.deepEqual(rec, {
    name: 'g1',
    'taxonomy.id': '9606',
    'taxonomy.code': 'HUMAN',
    'taxonomy.scientific_name': 'Homo sapiens',
    'taxonomy.common_name': 'human',
    'taxonomy.rank': 'species',
    'sequence.accession': 'P12345',
    'sequence.name': 'Protein one',
    'sequence.symbol': 'P1',
    'sequence.location': 'chr1',
    'events.type': 'speciation',
    'events.duplications': 2,
    'events.speciations': 3,
    'color.red': 10,
    'color.green': 20,
    'color.blue': 30,
    width: 2.5,
    node_id: 'n1',
    'property.x:size': 42,
  });
  assert.equal(a.tree.annotations.get(0, 'id_source'), 'c0');
  // the scientific name first
  const b = parsePhyloXml(doc(body), { labelBy: 'scientific_name' });
  assert.deepEqual(b.tree.tipLabels, ['Homo sapiens', 'Pan troglodytes', 'GORGO', 'Q9']);
  // without annotations: none, and nothing else changes
  assert.equal(parsePhyloXml(doc(body)).tree.annotations, null);
});

test('what is not read is counted, once per place, however deep it goes', () => {
  const r = parsePhyloXml(
    doc(`<description>d</description><clade><clade><name>A</name><distribution><desc>x</desc><point><lat>1</lat></point></distribution><distribution/></clade>
      <clade><name>B</name><sequence><mol_seq>ACGT</mol_seq></sequence><reference doi="x"/></clade></clade><other/>`),
  );
  const got = Object.fromEntries(r.ignored.map((n) => [n.path, n.message.split(' ')[0]]));
  assert.deepEqual(got, {
    'phylogeny/description': '1',
    'clade/distribution': '2',
    'sequence/mol_seq': '1',
    'clade/reference': '1',
    'phylogeny/other': '1',
  });
  assert.ok(r.ignored.every((n) => n.code === 'phyloxml-ignored-element'));
  assert.deepEqual(parsePhyloXml(doc('<clade><name>A</name></clade>')).ignored, []);
});

test('several phylogenies: the one asked for, the count, and none counted from the others', () => {
  const x = `<phyloxml><phylogeny><name>one</name><clade><name>A</name></clade></phylogeny>
    <phylogeny rooted="false" branch_length_unit="subs"><name>two</name><description>skip</description><clade><clade><name>B</name></clade><clade><name>C</name></clade></clade></phylogeny>
    <phylogeny><name>three</name><distribution/><clade><name>D</name></clade></phylogeny></phyloxml>`;
  const [a, b, c] = [0, 1, 2].map((i) => parsePhyloXml(x, i));
  assert.deepEqual([a.treeName, b.treeName, c.treeName], ['one', 'two', 'three']);
  assert.deepEqual([a.tree.tipLabels, b.tree.tipLabels, c.tree.tipLabels], [['A'], ['B', 'C'], ['D']]);
  assert.deepEqual([a.treeCount, b.treeCount, c.treeCount], [3, 3, 3]);
  assert.deepEqual([a.rooted, b.rooted], [null, false]);
  assert.equal(b.lengthUnit, 'subs');
  assert.deepEqual(a.ignored, []); // the description of tree two is not in the notes of tree one
  assert.deepEqual(
    b.ignored.map((n) => n.path),
    ['phylogeny/description'],
  );
  assert.deepEqual(parsePhyloXml(x, { treeIndex: 1 }).tree.tipLabels, ['B', 'C']);
  assert.throws(() => parsePhyloXml(x, 3), /no phylogeny number 3 in phyloXML \(saw 3\)/);
});

test('XML details: prefixes, entities, CDATA, comments, DOCTYPE, PIs, quotes, whitespace', () => {
  const x = `<?xml version='1.0'?>
<!DOCTYPE phyloxml [ <!ENTITY e "x>y"> <!-- a > comment --> ]>
<?stylesheet href="a.css"?>
<phy:phyloxml xmlns:phy="http://www.phyloxml.org" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="a b">
  <phy:phylogeny rooted='true'>
    <!-- a comment with <clade> in it -->
    <phy:clade phy:branch_length='1e-2'>
      <phy:clade><phy:name>  A &amp; B &lt;1&gt; &#65;&#x42; &quot;q&quot; &apos;s&apos;  </phy:name></phy:clade>
      <phy:clade><phy:name><![CDATA[C <raw> & D]]></phy:name></phy:clade>
      <phy:clade><phy:name>E<!-- inside -->F</phy:name></phy:clade>
      <phy:clade><phy:name title="a > b">G</phy:name></phy:clade>
    </phy:clade>
  </phy:phylogeny>
</phy:phyloxml>`;
  const r = parsePhyloXml(x);
  assert.deepEqual(r.tree.tipLabels, ['A & B <1> AB "q" \'s\'', 'C <raw> & D', 'EF', 'G']);
  assert.equal(r.tree.length[0], 0.01);
});

test('a very deep tree and a very wide one do not recurse or overflow', () => {
  const depth = 200000;
  let x = '';
  for (let i = 0; i < depth; i++) x += '<clade branch_length="1">';
  x += '<name>tip</name>';
  for (let i = 0; i < depth; i++) x += '</clade>';
  const r = parsePhyloXml(doc(x));
  assert.equal(r.tree.nodeCount, depth);
  assert.equal(r.tree.tipCount, 1);
  assert.equal(r.tree.maxDepth, depth - 1);
  let wide = '<clade>';
  for (let i = 0; i < 100000; i++) wide += `<clade><name>t${i}</name></clade>`;
  const w = parsePhyloXml(doc(wide + '</clade>'));
  assert.equal(w.tree.tipCount, 100000);
  assert.equal(w.tree.tipLabels[99999], 't99999');
});

test('malformed input throws a NewickError with a position, whatever the mode', () => {
  const bad = [
    ['', /no element found/],
    ['<newick/>', /not phyloXML: the root element is <newick>/],
    ['<phyloxml><phylogeny><clade></phylogeny></phyloxml>', /<\/phylogeny> does not match <clade>/],
    ['<phyloxml><phylogeny><clade/>', /<phylogeny> is not closed/],
    ['<phyloxml></phyloxml></x>', /<\/x> closes nothing/],
    ['<phyloxml><!-- never closed', /unterminated comment/],
    ['<phyloxml><phylogeny><clade><name><![CDATA[x</name></clade></phylogeny></phyloxml>', /unterminated CDATA/],
    ['<phyloxml><phylogeny><clade a=b/></phylogeny></phyloxml>', /no quoted value/],
    ['<phyloxml><phylogeny><clade a="b/></phylogeny></phyloxml>', /unterminated attribute value/],
    ['<phyloxml><phylogeny><clade><clade/></clade><clade/></phylogeny></phyloxml>', /more than one root clade/],
    ['<phyloxml><phylogeny><name>x</name></phylogeny></phyloxml>', /has no clade/],
    ['<phyloxml><phylogeny><clade', /unterminated <clade> tag/],
  ];
  for (const [x, re] of bad) {
    for (const strict of [false, true]) {
      assert.throws(
        () => parsePhyloXml(x, { strict }),
        (e) => e.name === 'NewickError' && re.test(e.message) && typeof e.position === 'number',
        x.slice(0, 50),
      );
    }
  }
});

test('a branch length that is not a number is a warning (strict throws), the length is missing', () => {
  const x = doc('<clade><clade branch_length="abc"><name>A</name></clade><clade><name>B</name><branch_length></branch_length></clade></clade>');
  const r = parsePhyloXml(x);
  assert.deepEqual(
    r.tree.warnings.map((w) => w.code),
    ['non-numeric-length', 'non-numeric-length'],
  );
  assert.ok(Number.isNaN(r.tree.length[1]) && Number.isNaN(r.tree.length[2]));
  assert.throws(() => parsePhyloXml(x, { strict: true }), /non-numeric-length/);
});

test('the Biopython examples (phyloxml.org): every phylogeny agrees with Biopython 1.88', () => {
  const x = read(path.join(HERE, 'fixtures/phyloxml/phyloxml_examples.xml'));
  assert.equal(parsePhyloXml(x).treeCount, 14);
  const tips = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3];
  const lensum = [0.792, 0.792, 0.792, 0, 0, 0, 0.792, 0, 0, 0, 0, 0, 0, 0.792];
  for (let i = 0; i < 14; i++) {
    const t = parsePhyloXml(x, i).tree;
    assert.equal(t.tipCount, tips[i], `phylogeny ${i}`);
    let sum = 0;
    for (let n = 1; n < t.nodeCount; n++) if (!Number.isNaN(t.length[n])) sum += t.length[n];
    assert.ok(Math.abs(sum - lensum[i]) < 1e-9, `phylogeny ${i}: ${sum}`);
  }
  assert.equal(parsePhyloXml(x, 2).tree.support[1], 89); // the confidence of the inner clade
  assert.deepEqual(parsePhyloXml(x, 4).tree.tipLabels, ['Bacillus subtilis', 'Bacillus subtilis', 'Caenorhabditis elegans']); // named by taxonomy
  assert.deepEqual(parsePhyloXml(x, 9).tree.tipLabels, ['Varanus niloticus', 'Varanus storri', 'Varanus timorensis']);
  const m = read(path.join(HERE, 'fixtures/phyloxml/made_up.xml'));
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((i) => parsePhyloXml(m, i).tree.tipLabels),
    [['c'], ['A', 'B'], ['A'], ['A'], ['22_MOUSE'], ['Eukaryota']],
  );
  assert.equal(parsePhyloXml(m).treeCount, 6);
});

// The real trees of data/rich, against the numbers of data/rich/scripts/treecheck.py (an independent implementation, in Python).
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'rich/manifest.json'), 'utf8')).datasets;
for (const d of manifest.filter((x) => x.format_detected === 'phyloxml')) {
  test(`data/rich/${d.id}: tips, nodes, root and branch lengths agree with treecheck.py`, () => {
    const r = parsePhyloXml(read(path.join(DATA, 'rich', d.main_tree)));
    const t = r.tree;
    assert.equal(t.tipCount, d.tips);
    assert.equal(t.nodeCount, d.tips + d.internal_nodes);
    assert.equal(t.children(0).length, d.root_children);
    const bl = d.branch_lengths;
    const lens = [];
    for (let i = 1; i < t.nodeCount; i++) if (!Number.isNaN(t.length[i])) lens.push(t.length[i]);
    assert.equal(lens.length, bl.n_with);
    assert.equal(t.nodeCount - 1 - lens.length, bl.n_missing);
    assert.equal(lens.filter((v) => v === 0).length, bl.n_zero);
    assert.ok(Math.abs(Math.min(...lens) - bl.min) <= 1e-9 * Math.max(1, Math.abs(bl.min)));
    assert.ok(Math.abs(Math.max(...lens) - bl.max) <= 1e-9 * Math.max(1, Math.abs(bl.max)));
    assert.equal(r.treeCount, d.trees_in_main_file);
  });
}

test('Ensembl Compara gene trees: gene ids as names, the species through the taxonomy', () => {
  const f = path.join(DATA, 'rich/ens-phyloxml/ncrna_default.tree.1400489683.phyloxml.xml');
  const r = parsePhyloXml(read(f), { annotations: true });
  assert.equal(r.tree.tipCount, 101);
  assert.ok(r.tree.tipLabels.every((l) => /^ENS[A-Z]*G\d+$/.test(l)));
  const sp = parsePhyloXml(read(f), { labelBy: 'scientific_name' }).tree.tipLabels;
  assert.ok(
    sp.every((l) => /^[A-Z][a-z]+ [a-z]+/.test(l)),
    sp.find((l) => !/^[A-Z][a-z]+ [a-z]+/.test(l)),
  );
  assert.equal(r.tree.annotations.get(0, 'taxonomy.scientific_name'), 'Chordata');
  assert.deepEqual(
    r.ignored.map((n) => n.path),
    ['phylogeny/property'],
  );
});

test('only elements in the phyloXML namespace (or in none) are read; the others are counted under their namespace', () => {
  const x = `<phyloxml xmlns="http://www.phyloxml.org" xmlns:o="http://www.other.org" xmlns:px="http://www.phyloxml.org">
    <o:alignment><o:seq>acgt</o:seq></o:alignment>
    <o:phylogeny><o:name>not a phylogeny</o:name></o:phylogeny>
    <px:phylogeny rooted="true"><px:name>real</px:name>
      <px:clade><px:name>root</px:name>
        <px:clade><px:name>A</px:name><px:taxonomy><px:common_name>cat</px:common_name><o:common_name>wrong</o:common_name></px:taxonomy></px:clade>
        <o:clade size="4"><o:name>foreign clade</o:name></o:clade>
        <clade xmlns="http://www.other.org"><name>another foreign clade</name></clade>
        <px:clade><px:name>B</px:name></px:clade>
      </px:clade></px:phylogeny>
    <o:phylogeny/></phyloxml>`;
  const r = parsePhyloXml(x, { annotations: true });
  assert.equal(r.treeCount, 1);
  assert.equal(r.treeName, 'real');
  assert.deepEqual(r.tree.tipLabels, ['A', 'B']); // A is named by its <name>, not by the taxonomy
  assert.equal(r.tree.annotations.get(r.tree.tipNode[0], 'taxonomy.common_name'), 'cat');
  assert.deepEqual(Object.fromEntries(r.ignored.map((n) => [n.path, n.message.split(' ')[0]])), {
    'phyloxml/{http://www.other.org}alignment': '1',
    'phyloxml/{http://www.other.org}phylogeny': '2',
    'taxonomy/{http://www.other.org}common_name': '1',
    'clade/{http://www.other.org}clade': '2',
  });
  // no namespace at all (PANTHER writes it so), and a document that is not phyloXML
  assert.equal(parsePhyloXml('<phyloxml><phylogeny><clade><clade><name>A</name></clade></clade></phylogeny></phyloxml>').tree.tipCount, 1);
  assert.throws(
    () => parsePhyloXml('<phyloxml xmlns="http://www.other.org"><phylogeny><clade/></phylogeny></phyloxml>'),
    /no phylogeny number 0|not phyloXML/,
  );
  assert.throws(
    () => parsePhyloXml('<o:phyloxml xmlns:o="http://www.other.org"/>'),
    /not phyloXML: the root element is <\{http:\/\/www.other.org\}phyloxml>/,
  );
});

test('the confidence of an <events> element is not branch support, it is an annotation', () => {
  const r = parsePhyloXml(
    doc(
      '<clade><events><type>duplication</type><confidence type="duplication_confidence_score">0.8</confidence></events><clade><name>A</name></clade><clade><name>B</name></clade></clade>',
    ),
    { annotations: true },
  );
  assert.ok(Number.isNaN(r.tree.support[0]));
  assert.equal(r.tree.annotations.get(0, 'events.confidence.duplication_confidence_score'), 0.8);
  assert.deepEqual(r.ignored, []);
});
