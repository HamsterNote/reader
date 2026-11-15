# HAM-268 S14 Release performance plan

This is the preflight protocol for 6.3. It deliberately compares the same
document, device, build configuration, and launch state; only the renderer
changes between the Web baseline and native candidate.

## Fixed setup

- Device: one physical iPhone chosen by the Mac operator; record model, iOS,
  Xcode, SDK, thermal state, battery state, and free storage.
- Build: Release, same commit, same signing profile, no debugger attached,
  network disabled after assets are staged.
- Fixture: the same 200-page PDF used by S08, with its SHA256 recorded.
- Runs: five cold launches per renderer, then one 60-second continuous scroll
  run per renderer after the fifth launch. Reboot or terminate the app between
  cold launches; do not reuse a warmed process.
- Order: alternate Web and Native (`Web, Native, Web, Native...`) to reduce
  thermal and time drift. Record any thermal throttling and discard neither
  result; annotate it in the report.

## Measurements

1. **First visible page:** milliseconds from process launch to the first frame
   containing nonblank PDF pixels. Report all five values and median/p95.
2. **Peak resident memory:** maximum resident footprint during each 60-second
   scroll, sampled once per second with Instruments/MetricKit. Report MB and
   peak delta (Native minus Web).
3. **Render calls:** PDF page draw/render count during the 60-second scroll,
   separated into visible pages and preview/thumbnail work. Report total and
   calls per minute.
4. **Cache/temporary resources:** peak page-view count, preview count, texture
   bytes, and temporary preview files. Verify all temporary files disappear
   after close.
5. **Functional guard:** S02/S08 page number, offset, content size and inset
   values must remain at the accepted deterministic values; a performance run
   with a functional failure is invalid regardless of speed.

## Report format

Store the raw Instruments export, device console log, fixture hash, commit SHA,
and command under the issue attachment. Summarize a table with five cold-start
values, median, p95, peak memory, render calls/minute, cache peak, and the Web
minus Native delta. The acceptance gate is two non-regressions against Web and
at least one 20% improvement; if either fails, keep 6.4 frozen and report the
failed metric with raw evidence.

The Linux regression script prepares type checks, unit tests, browser checks,
build and OpenSpec validation. It cannot produce S14 device measurements.
