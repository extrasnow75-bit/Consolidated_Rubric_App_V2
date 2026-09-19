## What's new in v0.9.6

### Documents with a lot of rubrics now work

A document holding 26 rubrics failed after four minutes with a message about JSON, and deployed
nothing at all — not even the twenty-odd rubrics it had already converted before it stopped.

The app was asking the AI for every rubric in the document in one request, and a single reply has
a size limit. A long document reaches it, the reply is cut off mid-sentence, and everything in it
is lost together.

**The app now counts the rubrics first.** Up to eight, it works as before — one request, quick.
Past eight, it converts each rubric on its own. That takes longer, and the timeline names each
one as it finishes, but there is no shared limit to run into, and a rubric that does fail costs
only itself: the rest of the document still deploys.

If you split a long document in half to get around this, you no longer need to.

### The list of files now says what it is

The list under the upload box is not a history of what you have picked. **Every file in it is
deployed**, and since deploying only ever adds rubrics to a course, a file left there by mistake
means duplicates you have to delete in Canvas by hand.

It now has a heading — **"Will be deployed — 2 documents"** — and when more than one file is
queued the button counts them too: *"Analyze 2 Documents and Deploy To Canvas."* If that number
is ever a surprise, you find out before Canvas does.

The **×** beside a file removes it from the list, as before.

### Known limits, unchanged

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
