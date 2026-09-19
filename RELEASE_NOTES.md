## What's new in v0.9.8

### Large documents convert in about a quarter of the time

A document with more than eight rubrics used to be converted one rubric at a time, and every one
of those requests carried the whole document with it. A twenty-six rubric document therefore sent
that document twenty-seven times, with a six-second pause between each — roughly four minutes,
most of it spent re-reading the same file.

Rubrics are now converted in groups of eight. The same document takes four requests instead of
twenty-seven, and finishes in well under a minute.

Groups rather than one single request, because a request that tries to return every rubric at once
can run past the AI's output limit and lose all of them — which is what used to happen on
documents around this size. A group that has trouble now costs only the rubrics in it, and those
are retried individually rather than lost. Documents of eight rubrics or fewer are unaffected;
they were already a single request.

Part 2 was never doing this grouping at all, even for small documents, so converting a three-rubric
document there took four requests where it should have taken two. Both screens now work the same
way.

### Rubric descriptions are shorter

Generated rating descriptions had grown to several lines per box. With four boxes per row that
makes a rubric slow to grade with, and in Canvas's fixed-width rating columns it is a rubric
students scroll through rather than read.

The AI is now asked to keep each description to one sentence — twenty words at most, ten to
fifteen preferred — and to say what the work actually has, lacks or does inconsistently rather
than opening with "The student…" and hedging.

Shorter does not mean vaguer: it is also told that each level must stay unmistakably different
from the ones above and below it, because the easy way to be brief is to write the same sentence
four times with the adjective swapped, and that helps nobody.

**This applies only to rubrics the app writes for you.** A rubric it reads out of your document or
a screenshot is copied word for word, as it always has been. Your wording is your wording, and
shortening it would change what students are being graded against.

### Screen readers are told what is happening

Converting and deploying can take minutes, and until now they happened in complete silence for
anyone not watching the screen. A run would start, make progress, partly fail and finish without
announcing any of it.

Each of the three screens that runs a long job now announces the result when it finishes, and the
progress bars report their percentage to assistive technology so progress can be checked at any
point without waiting to be told.

### The file pickers work without a mouse

Five of the six "drop a file here, or click to browse" areas could not be reached with the
keyboard at all — Tab skipped straight past them, so there was no way to load a document, a
screenshot or a replacement rubric without pointing and clicking. All of them are now reachable by
Tab and open with Enter or Space. Drag and drop is unchanged.

### The Google Drive browser behaves like a proper dialog

Tab used to walk out of the Drive picker into the page behind it, and closing the picker left the
keyboard focus nowhere in particular. Tab now stays inside it, and closing it returns you to the
button you opened it from.

### A new app icon

The icon is now a rubric table above an upload arrow, matching Canvas Extractor Tools, which the
same people tend to have open at the same time. The two are deliberately near-identical apart from
the arrow: the Extractor pulls rubrics down out of Canvas, this one pushes them up into it. It also
reads properly at taskbar and Dock size, which the old one did not.

### Also fixed

- Timestamps in the deployment timeline were too dark to read against their background.

### Known limits, unchanged

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
