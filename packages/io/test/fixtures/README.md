# Test fixtures

| File | What | Source and licence |
|---|---|---|
| `biopython-test_Nexus_input.nex` | A "weird but NEXUS standard compatible" file: an interleaved DATA block whose second taxon is spelled both `'t2 the name'` and `t2_the_name`, a SETS block, a private SPAM block, nested comments, three trees. | `Tests/Nexus/test_Nexus_input.nex` in the Biopython 1.88 source distribution (PyPI, fetched 2026-10-27, unmodified). Biopython License Agreement (permission to use, copy, modify and distribute for any purpose without fee, provided the copyright notice and permission notice are kept): https://github.com/biopython/biopython/blob/master/LICENSE.rst |
| `phyloxml/phyloxml_examples.xml`, `phyloxml/made_up.xml`, `phyloxml/distribution.xml`, `phyloxml/example.xml` | The phyloXML examples (14 phylogenies: branch lengths as attribute and element, confidences, taxonomy, distribution, properties, a clade with `rooted` unset) and three small made-up files that Biopython tests its phyloXML reader with. | `Tests/PhyloXML/` in the Biopython repository (commit 893f154, fetched 2026-10-27, unmodified). Biopython License Agreement below. `phyloxml_examples.xml` is the example file published on phyloxml.org; I did not verify its licence beyond Biopython redistributing it. |

## Biopython License Agreement

The permission notice and disclaimer that come with `biopython-test_Nexus_input.nex` (from Biopython's `LICENSE.rst`):

> Permission to use, copy, modify, and distribute this software and its documentation with or without modifications and for any purpose and without fee is hereby granted, provided that any copyright notices appear in all copies and that both those copyright notices and this permission notice appear in supporting documentation, and that the names of the contributors or copyright holders not be used in advertising or publicity pertaining to distribution of the software without specific prior written permission.
>
> THE CONTRIBUTORS AND COPYRIGHT HOLDERS OF THIS SOFTWARE DISCLAIM ALL WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS, IN NO EVENT SHALL THE CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Biopython's own copyright notices are in its `LICENSE.rst` (https://github.com/biopython/biopython/blob/master/LICENSE.rst); I could not find a per-file copyright line in this test file.
