Bobby Caldwell audio files for the study music player.

The player expects these literal filenames in this directory:

  Bobby Caldwell Open Your Eyes.mp3              → Compute phase
  Bobby Caldwell My Flame.mp3                     → Save phase
  Bobby Caldwell What You Won't Do for Love.mp3   → Exhibit-ready phase
  Bobby Caldwell Down for the Third Time.mp3     → PDF / TXT render phase

Filenames are URL-encoded at fetch time, so spaces + apostrophes work
fine — just keep the names exactly as above.

To swap titles or add tracks, edit the TRACKS map in
src/ui/lib/studyMusic.js — that's the only place filename strings
live.  The player silently no-ops on 404, so a missing file = silence
with no visible error.
