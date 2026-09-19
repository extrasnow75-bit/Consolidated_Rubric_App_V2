## What's new in v0.9.5

**Install this one.** It replaces the AI model the app runs on, ahead of Google switching the old
one off on 16 October. Versions up to v0.9.4 will stop working on that date, and may stop sooner
for anyone creating a new Gemini API key.

### The AI model has changed

The app now uses **gemini-3.5-flash-lite** for reading rubrics, building CSV files and suggesting
repairs, and **gemini-3.8-flash** for reading a rubric out of a screenshot.

Two reasons, and the deadline is the smaller one.

**The old model is being switched off.** Google retires gemini-2.5-flash on 16 October 2026, and
it has already begun refusing newly created API keys. That would have looked like the app being
broken for anyone setting it up for the first time, while continuing to work for everyone already
running it.

**The new model also has a far bigger free allowance** — roughly 1,500 requests a day rather than
the 20 a day the full Flash models have been cut to. An ordinary session uses five to ten, and a
document with twenty rubrics uses twenty-one, so the old allowance would have run out on the first
afternoon.

Screenshots keep the stronger model on purpose. It is the only place where misreading a digit
produces a number that looks perfectly valid, so nothing downstream can catch it — everywhere
else, a bad answer produces a refusal you can see.

### PDFs work everywhere now

**You can upload a PDF full of rubrics from your computer.** Before, that box took Word files
only: the file chooser hid PDFs, and a dragged PDF was discarded without a word — no error, no
file added, nothing. The card beside it offered PDFs from Google Drive, and Part 2 accepted them
from your computer, so the same file worked or silently did not depending on where it came from.

It also tells you now when it refuses a file, instead of appearing not to have noticed.

**A PDF that no text can be read from now says so.** A scan, or a photograph of a page, is a
picture of words rather than words, and it cannot be read without OCR, which the app does not do.
It used to leave the box empty with no explanation. It now names the file and suggests pasting the
text in instead. That was true in five separate places and is fixed in all of them.

For rubric documents this matters less than you might expect: a scanned rubric sent to the AI is
read as an image, so it can still work. It is only the assignment-description box in Part 1 that
needs real text.

### The Help Center links to the article

**Help Center → Resources & Training** now has a link to the Canvas Rubric Creator article. It
points at the working draft for now and will move to the eCampus Help Center once published.

### Known limits, unchanged

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
