# @gbif-phylo/viewer

A framework-free phylogenetic tree viewer on Canvas 2D. It renders very large trees (a million tips) by drawing a level-of-detail cut of the
tree each frame, in rectangular and radial layouts, with aligned per-tip columns, keyboard navigation and accessible tip links.

* [API reference](docs/api.md)
* [Internals](docs/internals.md): how the core works and how to change it safely.

Use it directly from any framework, or through [`@gbif-phylo/react`](../react). Tree files are parsed by [`@gbif-phylo/io`](../io).
