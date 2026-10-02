# Third-party notices

## SHA-256 WGSL shader (`src/shader.wgsl.js`) — ORIGIN NOT YET CONFIRMED

The shader carries no license header or attribution in the original source
repository, so its provenance was reconstructed by comparing it against the two
works cited in the paper and against the likely common ancestor. Evidence:

| Candidate | License | Match against our shader |
|---|---|---|
| [B-Con/crypto-algorithms](https://github.com/B-Con/crypto-algorithms) `sha256.c` / `sha256.h` (Brad Conte) | Public domain ("This code is presented 'as is' without any guarantees.") | **Strongest match.** Struct is literally named `SHA256_CTX` with fields `data[64]`, `datalen`, `bitlen`, `state[8]` in that order, and the macros `ROTLEFT`, `ROTRIGHT`, `CH`, `MAJ`, `EP0`, `EP1`, `SIG0`, `SIG1` plus `sha256_transform` / `sha256_update` / `sha256_final` are all identical names. Our WGSL is a near-transliteration. |
| [ligeroinc/ligero-prover](https://github.com/ligeroinc/ligero-prover) `shader/sha256.wgsl` (paper ref. [46]) | **Apache-2.0** | **Partial match.** Shares the same macro names and the same WGSL-specific adaptation of splitting `bitlen` into `array<u32, 2>` (C uses one 64-bit integer). But its struct is named `sha256_batch_context` and is a batched, per-instance-array rewrite, whereas ours is scalar. Not a direct copy. |
| [MarcoCiaramella/sha256-gpu](https://github.com/MarcoCiaramella/sha256-gpu) (paper ref. [47]) | Unlicense (public domain) | **No structural match.** Defines no `SHA256_CTX`, and uses entirely different helpers (`swap_endianess32`, `shw`, `r`). Not the source. |

Differences from Brad Conte's original worth recording: our struct adds an
unused `info : u32` field (not present upstream), and `bitlen` is split into two
`u32` values because WGSL has no 64-bit integer type — the same adaptation
Ligero made.

**Open item for the authors.** If the shader was in fact transliterated from
Ligero's `shader/sha256.wgsl`, Apache-2.0 §4 requires retaining its copyright
and license notice in `src/shader.wgsl.js`, and that file then cannot be
redistributed under the MIT grant in `LICENSE`. If it came from Brad Conte's
public-domain code (which the naming evidence favours), attribution is a
courtesy rather than an obligation and MIT is fine. Please confirm which it was
and, if Ligero, add the Apache-2.0 header to that file. The paper's citations
[46] and [47] should also be checked against whichever is correct — [47] is
demonstrably not the source.

## Excel export

No third-party library. `src/xlsx-min.js` is a hand-written, dependency-free
.xlsx writer (stored-ZIP container plus SpreadsheetML worksheet). SheetJS was
considered and rejected: the npm `xlsx` package is pinned at 0.18.5 with two
high-severity advisories that have no fix available on npm
(GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9 ReDoS). Both are
parser bugs that this page would never reach, but a public research artifact
should not carry a permanently unresolvable audit finding.

## vite 7

MIT. Build tool and dev server only; not shipped in the page bundle beyond its
standard module preamble. <https://github.com/vitejs/vite>
