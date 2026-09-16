## What's new in v0.9.0

**This is a preview build for user testing.** It is numbered below 1.0 on purpose: the workflow
is complete and the app is safe to use on real courses, but it has not been through a round of
feedback yet. Please tell us what is confusing, broken, or missing.

The app was previously a website. This is the same workflow as a program you install, which
changes three things that mattered.

- **Your Canvas token is no longer stored in a browser.** It now lives in your computer's own
  keychain — Windows Credential Manager or the macOS Keychain — and the part of the app you can
  see never has access to it. A Canvas token can read every student record you can see, so this
  was the main reason for the move.
- **No more CORS browser extension.** Uploading to Canvas just works. The instructions about
  installing an extension and whitelisting your Canvas URL no longer apply to anything.
- **Rubrics open in Google Docs, with the table intact.** Previously, saving a rubric to Drive
  flattened it into plain text and lost the grid. There is also a "Save to this computer" button
  that needs no Google account at all.

Also in this release:

- Browse your Google Drive from inside the app — Recent, My Drive, Shared with me, search and
  folders — replacing the old Google file-picker pop-up.
- Sign in to Google through your normal browser, and stay signed in between launches.
- The Canvas course box now opens filled in with the course you used last time, so you only need
  to change the course number.
- Choosing an option under "Phase 1" now scrolls you to the next step. Previously the step
  appeared below the bottom of the window and the button looked like it had done nothing.
- Buttons that cannot be used yet now look switched off and say what is missing, instead of
  appearing faint and ignoring clicks.
- Zoom the interface with Ctrl/Cmd and the + or − keys; the app remembers the setting.
- The app tells you when a newer version is available.

### Known limits in this preview

- **Google sign-in asks you to sign in again about once a week.** This is a Google restriction
  on apps that are still in testing, not a bug. Everything except the Drive features works
  without signing in at all.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**. It appears because the app has not been through Google's public
  review, which is not required for internal use.
