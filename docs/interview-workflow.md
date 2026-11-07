# Interview workflow

How a recording becomes data. The public repo (`vigs`) gets metadata, approved claims and record updates. Transcripts and audio stay private.

```
recording ──► transcript (private archive) ──► claims (draft) ──► record updates (branch) ──► review ──► public
```

## Where things live

| Material | Where |
|---|---|
| Audio | Private storage (Google Drive / Dropbox), one folder per interview |
| Full transcripts | Private repo, e.g. `vigs-archive/transcripts/<interview-id>.md` (format: `templates/transcript.md`) |
| Signed release forms | Private storage |
| Interview metadata + consent | `data/interviews/<interview-id>.yaml` (public; the build strips `archive` and `restrictions`) |
| Claims | `data/claims/` — only `review: public` claims appear in the public build |

## Steps

1. **Before the interview.** Run `python3 tools/vigs.py glossary` and paste `glossary/glossary.txt` into the transcription tool's custom vocabulary (or `glossary/prompt.txt` into Whisper's initial prompt). Check the "Gaps / questions for interviews" section of `research/vancouver-indie-timeline-v2.md` and the `open_questions` on related events for things to ask this person.
2. **Record and get consent.** Note any off-the-record stretches with timestamps.
3. **Transcribe.** Any tool that exports timestamps and speaker names works (`.srt`, `.vtt`, or text with timecodes). Save it in the private archive using `templates/transcript.md`.
4. **Hand it to Claude.** Paste or upload the transcript (or attach the private archive repo to the session) and ask it to process the interview. Claude will:
   - create `data/interviews/<id>.yaml` from `templates/interview.yaml`;
   - extract claims with timestamps into `data/claims/`, all `review: draft`, tagged to existing people, games, orgs, places and events; skip anything inside `restrictions`;
   - propose new records (people, studios, events) and updates to existing ones, citing the claims — upgrading `unverified` facts, filling dates, marking contradictions as `disputed` with both `accounts`;
   - answer matching `open_questions` and add new ones;
   - write a short report: what's new, conflicts with published sources or other interviews, gaps filled, and follow-up questions;
   - commit it all to a branch and run `python3 tools/vigs.py validate`.
5. **Review.** Read the diff. If the interviewee asked to approve quotes, send them their claims; mark approved ones `approved`, then `public`.
6. **Merge.** Set the interview's `process_status` to `published`.

## Rules Claude follows

- Never put transcript text in the public repo beyond the short `quote` on a claim, and only publish a quote when consent covers quotes.
- Never overwrite a published fact with an interview claim. Add the claim, and if it conflicts, mark the record `disputed` with both versions.
- Personal details (birth date, photo) only within the person's consent scope.
