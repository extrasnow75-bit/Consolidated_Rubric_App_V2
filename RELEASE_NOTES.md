## What's new in v0.9.1

**This is a preview build for user testing.** It is numbered below 1.0 on purpose: the workflow is
complete and the app is safe to use on real courses, but it has not been through a round of
feedback yet. Please tell us what is confusing, broken, or missing.

### When Canvas rejects a rubric, the app can now suggest a fix

Canvas sometimes refuses a rubric because of something in the file itself — a blank point value, a
points column holding "10-8" where it wants "10", a missing header row. Until now the app told you
to download the CSV, find the problem, and upload the corrected file in Part 3.

Now, on that kind of failure, there is a **Suggest a fix** button. The app sends the rubric and
Canvas's own complaint to the AI and shows you a corrected version.

What you get before anything is sent to Canvas:

- **A list of every cell that changed**, criterion by criterion — what it was, what it would become.
- **Point values called out separately, at the top.** These change what a student is graded on, and
  where a point value was missing the AI has *guessed* it — it has no way to know the criterion was
  worth 8 rather than 10. Check each one.
- **Three choices: use it and deploy, download it instead, or discard it.** Nothing is applied on
  its own, and nothing goes to Canvas until you click.

The app checks the AI's work before you ever see it. A suggestion that still would not load into
Canvas is thrown away, and so is one that quietly leaves a criterion out — a shorter rubric uploads
without complaint and grades wrongly, which is worse than the original failure. When that happens
the app says the AI could not fix it rather than showing you a suggestion it does not trust.

The button only appears when the rubric file is the problem. An expired Canvas token or a wrong
course number is not something the file can fix, and the app no longer offers to try.

### Installing for the first time?

The app was previously a website. This is the same workflow as a program you install, which changes
three things that mattered.

- **Your Canvas token is no longer stored in a browser.** It now lives in your computer's own
  keychain — Windows Credential Manager or the macOS Keychain — and the part of the app you can see
  never has access to it. A Canvas token can read every student record you can see, so this was the
  main reason for the move.
- **No more CORS browser extension.** Uploading to Canvas just works. The instructions about
  installing an extension and whitelisting your Canvas URL no longer apply to anything.
- **Rubrics open in Google Docs, with the table intact.** There is also a "Save to this computer"
  button that needs no Google account at all.

Also carried over from v0.9.0: an in-app Google Drive browser, Google sign-in through your normal
browser, the Canvas course box prefilled with the course you used last time, and zoom with
Ctrl/Cmd and the + or − keys.

### Known limits in this preview

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant. The change list is there so you can judge that
  part yourself, and point values are separated out because they are the ones worth your attention.
- **Google sign-in asks you to sign in again about once a week.** This is a Google restriction on
  apps that are still in testing, not a bug. Everything except the Drive features works without
  signing in at all.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**. It appears because the app has not been through Google's public review,
  which is not required for internal use.
