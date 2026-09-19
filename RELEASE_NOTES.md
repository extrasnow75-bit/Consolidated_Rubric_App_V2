## What's new in v0.9.7

### The app now tells you whether your Canvas token actually works

The Canvas card used to say **"Token saved"** the moment you pasted one in. That only ever meant
the text had been stored — nothing had tried it. A token that had been revoked, or mistyped, or
belonged to a different Canvas site looked exactly the same as a working one, and you found out
when a deploy failed, after the AI had already done its work.

It now says which of these is true:

- **Token checked — Canvas accepted it**
- **Token saved — not checked yet**
- **Canvas rejected this token**, with Canvas's own reason

The check needs to know which Canvas site to ask, and only a course URL says that, so it cannot
happen the instant you paste the token. It runs when the app starts, against the course you used
last time, and again whenever a course is confirmed. If you are offline it stays at "not checked
yet" rather than blaming a token that is probably fine.

### Cancelling no longer throws away the work already done

Stopping a run part-way used to discard every CSV it had built — including rubrics that had
already deployed successfully. On a twenty-rubric document, cancelling at eighteen lost all
twenty, and the offer to download the CSVs never appeared because the run had not "finished".

Each CSV is now kept the moment it is made. Cancel whenever you like and the download offer is
still there, with everything converted up to that point. The timeline also keeps the deploy
results as they happen, so a cancelled run still shows what reached Canvas.

The conversion is the slow, expensive part of a run. Losing it because the quick part was
interrupted was the wrong way round.

### Tidying underneath

Three internal connections between the two halves of the app were unused and have been removed.
Nothing changes on screen; there is simply less of the app able to talk to the part that holds
your credentials, which is the part worth keeping small.

### Known limits, unchanged

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
