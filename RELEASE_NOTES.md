## What's new in v1.0.0

First desktop release. The app was previously a website; this is the same workflow as a
program you install, which changes three things that mattered.

- **Your Canvas token is no longer stored in a browser.** It now lives in your computer's
  own keychain — Windows Credential Manager or the macOS Keychain — and the part of the app
  you can see never has access to it. A Canvas token can read every student record you can
  see, so this was the main reason for the move.
- **No more CORS browser extension.** Uploading to Canvas just works. The instructions about
  installing an extension and whitelisting your Canvas URL no longer apply to anything.
- **Rubrics open in Google Docs, with the table intact.** Previously, saving a rubric to
  Drive flattened it into plain text and lost the grid. There is also a "Save to this
  computer" button that needs no Google account at all.

Also in this release:

- Browse your Google Drive from inside the app — Recent, My Drive, Shared with me, search
  and folders — replacing the old Google file-picker pop-up.
- Sign in to Google through your normal browser, and stay signed in between launches.
- Zoom the interface with Ctrl/Cmd and the + or − keys; the app remembers the setting.
- The app tells you when a newer version is available.
