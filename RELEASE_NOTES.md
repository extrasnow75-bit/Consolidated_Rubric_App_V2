## What's new in v0.9.2

**This is a preview build for user testing**, like v0.9.1 before it. It fixes three faults found
the first time the app met a real rubric document — one of which had been quietly wrong since the
desktop version began. **Please replace v0.9.1 with this build.**

### Word documents now convert

Part 2 could not read a `.docx` file at all. It failed with *"Could not find file in options"*,
which reads like the file was missing and was nothing of the sort — the app was handing the
document to its Word reader the way a website would rather than the way a desktop program has to.

This affected every route a Word document could take: from your computer, from Google Drive, and
as an attachment in the chat. If you tried to convert a Word document in v0.9.0 or v0.9.1, this is
why it did not work. It was never anything about your file.

### Point values Canvas could not read no longer become zero

The more serious one. If a rating's point value was anything the app could not read as a
number — `>90`, `N/A`, or an empty cell — it silently became **0** and deployed that way. Canvas
accepts a zero without complaint, so there was no error and no warning. A criterion worth ninety
points would sit in your course worth nothing, and the first sign of it would be a student's grade.

The app now refuses the file and tells you exactly which ratings it could not read, and it offers
the AI repair for them.

It also reads the ways rubrics actually write point ranges, so these all work now:

| In your document | What Canvas gets |
|---|---|
| `4 to >3 pts` — Canvas's own wording, and what Canvas Extractor Tools writes | `4` |
| `4-3.5 points` | `4` |
| `40–50 pts` | `50` |
| `10 pts` | `10` |

**Rubrics pulled out of Canvas by Canvas Extractor Tools go back in unchanged.** That round trip is
now covered by a test, so the two apps cannot quietly drift apart.

What it will not guess at: `>90` and `<70` on their own, because they give one edge of a band and
no top; and `1,000`, because that comma means a thousand in some places and a decimal point in
others. You get a clear message and the repair offer instead of a number that might be wrong.

### The "what next?" box can be scrolled

On a smaller screen — or at 125% display scaling, or after one press of Ctrl + — the box that
appears after a rubric is generated was taller than the window, and its title and close button sat
above the top edge where nothing could reach them.

It scrolls now. While in there:

- **A "close the app" button**, which the box never had. It asks once before closing, because
  until you have saved your rubric it only exists in the app.
- **"Download as .docx & Stop" is gone.** It named a format this app stopped producing, and it did
  nothing when clicked. Use **Open in Google Docs** or **Save to this computer** on the rubric
  itself.

### Copy Logs now tells you whether it copied

**Copy Logs**, in the header of the Deployment Timeline, puts the whole log on your clipboard so
you can paste it into a message or a ticket. It was there before but said nothing when clicked —
and if the copy was refused, which could happen quietly, it also said nothing. It now says
**Copied**, or **Could not copy** if something went wrong, and the copy itself goes through a
route that cannot be silently refused.

The copied text now starts with the app version, the date and time, the Canvas course, and how
many rubrics succeeded and failed — so once it has been pasted somewhere else it still says what
it is. Your Canvas token is not in it and cannot be: the part of the app that writes the log is
never given the token.

### One button colour

Buttons that mean yes, continue, deploy or generate were blue in some parts of the app and green
in others. They are all Boise State blue now, the same blue as Canvas Extractor Tools, so the two
apps look like what they are. Green and amber are left to mean done and needs-attention.

The settings at the top of Part 1 were also using your operating system's own radio buttons, which
is why that screen looked like a web page inside a desktop app. They match the rest of the app now.

### Also here, added in v0.9.1: the AI can suggest a fix when Canvas refuses a rubric

When Canvas rejects a rubric because of something in the file — a blank point value, a points
column holding "10-8" where it wants "10", a missing header row — a **Suggest a fix** button
appears. The app sends the rubric and Canvas's own complaint to the AI and shows you a corrected
version, with every changed cell listed and point values called out separately at the top.

Nothing is applied on its own and nothing reaches Canvas until you click. A suggestion that still
would not load, or that quietly drops a criterion, is thrown away before you ever see it.

That offer now appears in one more place: when the app itself refuses the file over an unreadable
point value, which is the new check described above.

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
