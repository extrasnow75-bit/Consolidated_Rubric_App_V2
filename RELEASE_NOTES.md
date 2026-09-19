## What's new in v0.9.3

**This fixes the fault that made half the rubrics in a document fail.** If you tested v0.9.2 and
saw rubrics rejected with *"Some ratings do not have a point value Canvas can use"*, this is the
build that fixes it. Nothing was wrong with your documents.

### Rubrics whose wording contains commas now deploy

In v0.9.2, a ten-rubric document deployed five and failed five. Every failure named a point value
Canvas could not read — and the values it quoted were words, not numbers: `spelling`,
`introspection`, `academic`.

The cause was punctuation. The app asked the AI to write the spreadsheet file itself, including
the quoting rules that keep a comma inside a sentence from being read as the start of a new
column. It did not follow them. So a rating reading *"errors in grammar, spelling, and
punctuation"* became three columns instead of one, every value after it shifted one place along,
and the word `spelling` ended up where the points belonged.

The rubrics that worked were simply the ones whose wording happened to contain no commas.

**The app now builds the spreadsheet itself.** The AI is asked only to read the rubric out of your
document — which is what it is good at — and the file is assembled by the app, which gets the
punctuation right every time. This is how rubrics created in Part 1 have always been handled, and
they have never had this problem.

The same change also means a CSV you download is correct if you upload it to Canvas by hand: point
ranges are written as the single number Canvas wants, rather than as the band they came from.

**What has not changed is what happens to a point value the app genuinely cannot read.** It still
refuses the file and names the rating, and still offers the AI repair. It will not invent a number
to make a rubric deploy — a wrong grade is worse than a clear refusal.

### The course box now waits its turn

The **Target Canvas Course** card used to appear at the same moment as the card above it, already
filled in with the course you used last time and already showing a green tick. The card that still
needed you to choose a document sat above it looking finished, and the deploy button stayed greyed
out without saying which one was waiting.

The course card now appears only after you have chosen a rubric document, so the two are in order.

### Also in this build

Releases have been rebuilt correctly since v0.9.1 — a fault in the build pipeline meant the v0.9.2
page was published without its installers on the first attempt. That is fixed, and unrelated to
anything in the app itself.

### Known limits, unchanged from v0.9.2

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant. Point values are listed separately because they
  are the ones worth your attention.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug. Everything except the Drive features works signed out.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
