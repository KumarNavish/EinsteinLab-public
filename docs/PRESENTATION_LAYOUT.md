# Caption, controls and original-material separation

This is a scoped UI repair, not the public launch. It extends the audio-fix branch without changing model calls, voice selection, transcript contents or source files.

`presentation-layout.js` measures the actual footer, microphone dock and caption region. It reserves distinct occupied bands, updates after viewport/content changes, and disconnects observers on page exit. The stylesheet consumes those measurements; the optional PDF/video workspace uses the same protected bottom boundary. A wrapping mobile footer can no longer sit behind the microphone control, and a source-mode caption no longer inherits an inappropriate horizontal translation.

## Observed validation

The actual active development app at `http://127.0.0.1:8765/` passed **41/41 browser assertions** after the repair. It was tested at 1440x1000, 1280x720, 768x1024, 390x844 and 360x640; original-PDF layout was also tested at 1440x1000, 768x1024 and 390x844. Checks covered caption/status separation, footer/control separation, in-viewport captions, horizontal overflow, original-paper separation, optional captions and feedback controls. The console was clean and no model session or microphone was opened.

Caption and status text in that test was explicitly a layout fixture, not a research answer. PDF selection was for layout verification only. These checks do not establish scientific understanding or public deployment. The complete existing source suite and production build passed; the prior bundle-size warning remains.

The active development worktree includes earlier uncommitted PDF, caption and feedback components which are **not silently incorporated here**. This standalone branch preserves only the new measured-layout code and entry wiring. The remote-branch reproduction still needs its own full browser run; it must not be labelled a verified product release.

Mac evidence: `.work/c19-layout/report.json`, `browser-built.log`, per-viewport PNGs and `build.log`. The completed run was collected from `einstein-c19-connect-layout-at-observed-entry`, with terminal exit 0 observed in receipt `74d8e7456eee3d0f613a62e4fd5be8d1647113101b41ae8e533b832ef8ba1ccc`. Its decoded assertion output is in receipt `a7daa0d3aa96f48f86ff48e47ba524f71f3873e3338d4c5ef1ccef12dc79a043`.

## Current release limitations

No public HTTPS deployment exists. General paper/video/slide workflows, external visitor isolation, durable hosted feedback and the original character's public distribution entitlement remain release gates. Anam is not reintroduced. No provider key, user document, avatar binary, generated secret or real participant feedback is included in this patch.
