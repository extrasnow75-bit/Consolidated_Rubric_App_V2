## What's new in v0.9.4

Two changes, both asked for after v0.9.3 deployed a ten-rubric document to Canvas without a
single failure.

### Text size buttons in the toolbar

**Text size** now sits in the white bar at the top of the window, with **−**, a percentage, and
**+**. The percentage is also a button: click it to go back to 100%.

The keyboard shortcuts have always worked — **Ctrl** and **+** or **−** (**Cmd** on a Mac), and
**Ctrl/Cmd 0** to reset — but this app has no menu bar, so there was nothing on screen to
discover them from. They were written down in the Help Center, which is not where you look when
the text is too small to read.

Both routes do the same thing and the percentage keeps up with either, so the shortcuts still
work exactly as before. Your setting is remembered between sessions.

These are the same controls, in the same place, as Canvas Extractor Tools.

### The document picker opens on Google Drive

**From Google Drive** is now the tab you land on, since that is where these documents live.

If you are not signed in to Google it stays on **From Local Drive**, because the Google tab
signed out is a sign-in prompt rather than a way to choose a file — and whoever is signed out is
most likely the person whose Google login is playing up, who needs the local path to work. If you
pick a tab yourself, it stays picked.

### Known limits, unchanged

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant. Point values are listed separately because they
  are the ones worth your attention.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug. Everything except the Drive features works signed out.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
