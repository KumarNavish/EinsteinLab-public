# Developing an explanation on the original

[Opus’s browser-led design](OPUS_NORTH_STAR.md), “Chalk on the Original,” keeps the
visitor’s actual figure visible. Its API receipts and independent public
observations are preserved in `evidence/2026-10-18-opus-review`. A design review
is not public acceptance, and Opus did not hear the audio.

`teach_source` prepares two to six connected ideas from a successfully inspected,
visitor-approved PDF page. The model supplies only a title and returned region
IDs with eight to twenty spoken words per idea. The server resolves the source,
page and image hash from this connection's approved inspection ledger, then
applies the unchanged canonical provenance validator. Explicit metadata, foreign
regions, mixed inspections and stale pages are rejected. The request cannot
supply new coordinates. The page must match the current selected view;
returning to another page requires opening it explicitly.

The server computes a stable padded crop around the selected regions. The decoded inspection image
and its acknowledged crop establish the page aspect for that exact image hash.
Narrow crops expand with surrounding source pixels to fit a landscape workspace;
no selected region is clipped if the source is genuinely tall. Each
stage adds one source-bound mark, preserving earlier marks. The browser renders
the mark faintly on a separate annotation canvas and acknowledges its actual
crop and mark count. Only then does the server inject that stage’s commentary
into the existing GPT-Live session. Original source pixels remain unchanged.
Fixed speech directions belong to session startup; individual steps append only
their confirmed commentary, avoiding a repeated behavior-change instruction.
Cumulative marks reuse the same base crop; only the separate overlay repaints.
A different source page or crop gets a fresh base canvas.

Fresh rendered speech for the exact step starts a 700 ms ink animation, including
the existing speaker delay. Reduced motion inks immediately at that onset.
Earlier marks dim but remain. This is observed rendered output, not a claim that
the provider has completed a turn or that a person heard it.

Automatic advancement requires a fresh playback epoch, actual rendered signal,
a sentence-length focused passage, terminal punctuation and rendered quiet.
Commentary may paraphrase: exact vocabulary coverage is not a completion
condition. At least one narration anchor must add information beyond the focus
label. Ambiguous speech pauses; explicit Next records a manual advance.

New speech, typed input, Pause, Source, navigation, replacement or removal cancels
progression. Sequence IDs, view/intent revisions and retired IDs reject delayed
old actions. A source render waiting for acknowledgement is released promptly on
cancellation. An interrupted render can roll back only its own PDF/view/mutation;
it cannot overwrite newer visitor state. Source clears overlays on the retained
original. Removal stops old playback and suppresses remaining packets. Disconnect
restores explicit sharing controls for a retained PDF.

`teach_mechanism` remains available for an explicitly requested conceptual
explanation. It develops a cumulative diagram, with actual diagram and focus
acknowledgements before commentary. It is not the default replacement for a
source figure. Video frames and converted PowerPoint pages preserve their
existing source-sharing boundaries.

The original looping character performance remains inactive. Hands stay in their
authored rest; explicit source focus adds only a modest, held head/torso
orientation. It does not claim anatomical eye targeting or physical contact.
Breathing, blinking and audio-driven facial movement remain. Speech volume and
deadline renewal cannot move the focus goal; reduced motion consumes it.

The operator-pinned saved voice retains its original creation description.
Connected conversational delivery instructions follow that description, with age
in timbre rather than uniformly slow speech. No playback-rate processing is
applied. Visitors cannot create voices or choose an unknown custom ID, and
failure never selects a stock voice automatically. Preferences migrate once per
new operator default. Identity/configuration does not establish perceived age,
accent or naturalness; human listening remains decisive.

Existing models, paid API approval, spending limits, consent and free hosting
remain in force. There is no new planner tier, provider or permission expansion.
The pending indicator follows actual backend response creation and completion,
including the interval before a complete function call is available. Brief
hesitations stay in the transcript history without becoming idle captions.

## Verification

Offline tests exercise source provenance, exact crop acknowledgements, fresh
playback/onset epochs, incomplete speech, cached-page mismatch, cancellation,
stale rollback, disconnect sharing, authored hands and reduced motion. Actual
built-app/original-GLB/PDF rendering is separately recorded with authored fixture
audio and manual advancement; it establishes local mechanics only.

`qa/public-acceptance/experience.mjs --plan` describes source-v2: one bounded
public TraceMonkey Figure 2 walkthrough, all stages automatically heard and
inked, unchanged original pixels, narration timing, restart, interruption and
confirmed final usage. `--run` requires readiness/budget gates and the exact
deployed source/deployment ID. No latency target or prior failed report is
relaxed. The broader functional protocol separately covers the other app paths.

A mechanics pass still requires review of the explanation and actual voice.
