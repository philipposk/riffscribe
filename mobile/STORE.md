# Riffscribe — store listing draft

Not uploaded. Screenshots are not included: they need a build from Xcode (and
Android Studio) on a machine that has those tools. Do not invent them.

## Name

Riffscribe

## Subtitle (iOS, 30 characters)

Sheet music, tab and stems

## Short description (Play, 80 characters)

Turn a song into sheet music, tab and stems. Practice on the device.

## Description

Riffscribe listens to a song you already have and writes it out: standard
notation, guitar tab and MIDI, plus a backing track with the part you are
learning turned down.

Slow the song without changing the pitch, loop a section, scroll the score
while you play, tune up, and record yourself over the top. Stem splitting and
transcription run on the phone. The recording is not uploaded for that.

Sign-in is optional. A free account (Google or an email link) saves the chart
— the notes, tempo, key and sections — so you can open the same writing on
another device. The audio stays behind.

What you can do:

- Load a song from the Files app
- Remove the vocals instantly, or split into vocals, drums, bass and the rest
- Slow down, transpose, and loop
- Transcribe one part at a time to notation and tab
- Record an overdub and check it against the chart
- Export MIDI, MusicXML, and audio from the share sheet

## Keywords

sheet music, guitar tab, tablature, vocal remover, stem splitter, practice,
tuner, transcription, backing track, music

## Age rating

4+

No unrestricted web access beyond the app's own site, no user-to-user chat in
the listing sense, no gambling, no mature themes. The optional account stores
a chart, not a social feed. Confirm the questionnaire in App Store Connect and
Play Console against the build you actually submit; this draft is 4+ on the
content that ships today.

## Privacy

- Audio used for stem splitting, transcription, slow-down and overdub stays on
  the device. It is not the product uploaded to a server.
- An account is optional and is only for saved charts (and, if you use it, the
  assistant's chat text). Charts are the writing — notes, tempo, key, sections
  — not the recording.
- The microphone is used to record an overdub and to run the tuner. The app
  does not record other apps or phone calls.
- Sign-in is Google or an email link, through Supabase. Billing, if you
  upgrade on the website, is Stripe. The privacy policy on the site
  (https://riffscribe.6x7.gr/privacy) is the longer version and should be
  linked from both stores.
- Privacy nutrition / data safety: contact info (email) and user content
  (saved charts) are optional and tied to the account. Audio is not collected
  off the device for the studio. Do not declare microphone audio as data
  linked to the user unless a later build uploads it.

## Phone limitations (say this; do not promise desktop speed)

The iPhone and Android builds are the website in a native shell, with a
microphone, a share sheet, and a way back from Google sign-in.

AI stem split may fail on a phone. It is a large on-device model, and phones
run out of memory or abort the job. Instant vocal removal is the lighter
option and is the one to expect on a handset. The desktop site is the reliable
place for a full AI split. Do not claim the phone matches desktop performance,
and do not claim the app can capture audio from other apps.

## Screenshots and upload

Waiting on Xcode (iOS archive) and a signed Android App Bundle. This draft
does not attach images. Capture the studio with a song loaded, the mixer, the
score, and the tuner — from a real build, after the website deploy that
includes the native sign-in return.

## Before submit

1. Add and verify (on-device Google sign-in returns to the app)
   `gr.sixseven.riffscribe://auth/callback` on the Supabase redirect allow-list.
2. Deploy the web app so the shell's sign-in return, share sheet, and
   stem-split messages are on https://riffscribe.6x7.gr.
3. Generate `ios/` and `android/`, run `npm run native-config`, then build in
   Xcode / Android Studio.
4. Before `NEXT_PUBLIC_BILLING_ENABLED=true` on the website: confirm on a device
   build that the account and pricing pages show no Upgrade, Manage billing or
   withdraw controls in the shell (or implement StoreKit / Play Billing). The
   shell loads the live site, so turning billing on reaches the app without an
   update.
5. Replace this draft's privacy answers with the store questionnaires after a
   lawyer or the existing site policy is checked against those forms.

## Store submission

See `6x7-app-factory/mobile/STORE_READINESS.md` for the shared master checklist and audit script.

### Privacy policy URL (required in both stores)

- **URL:** https://riffscribe.6x7.gr/privacy
- **Status:** live (HTTP 200)
- Paste this URL in App Store Connect → App Privacy and Play Console → Store listing / Data safety.

### Sign in with Apple (Guideline 4.8)

- **Conditional** — required if Google is used for the primary account.
- Account is optional. If Google sign-in stays on the sign-in screen, add Sign in with Apple (Guideline 4.8).
- Implementation stub: enable Apple provider in Supabase/Auth0, add web button, allow native redirect `gr.sixseven.riffscribe://auth/callback`.

### Account deletion (Guideline 5.1.1(v))

- Optional — charts only; add in-app deletion if account is kept.

### Auth & redirect

- **Provider:** Supabase — Google, magic link (optional)
- **Native redirect (allow-list):** `gr.sixseven.riffscribe://auth/callback`

### iOS Privacy Manifest

- `ios/App/App/PrivacyInfo.xcprivacy` — applied via `6x7-app-factory/scripts/apply-privacy-manifest.py` (UserDefaults `CA92.1`; + FileTimestamp `C617.1` if `@capacitor/filesystem`).

