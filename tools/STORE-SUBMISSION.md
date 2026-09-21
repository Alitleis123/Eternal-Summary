# Chrome Web Store listing

Published. Version 1.6.0 went live on 18 September 2026:

https://chromewebstore.google.com/detail/eternal-summary/cpdeianknlpdhlbfdgckdcgfglbhkjbf

Everything the dashboard asks for is written out below, so an update does not
mean reconstructing it from memory. What follows is what the live listing says.
Nothing in this file ships in the extension.

Build the upload with `npm run package`, which writes
`eternal-summary-<version>.zip` containing only the nine files the manifest
names. Listing images come from `npm run shots`, which writes four 1280x800
captures to `docs/store/`.

---

## Before an update

- [ ] Bump `version` in `manifest.json`, the store rejects a version it has
      already seen
- [ ] `npm test` and `npm run check` pass
- [ ] `npm run package` and `npm run shots`
- [ ] Edit the listing copy here first if it is changing, then paste it into the
      dashboard, so this file stays the source

Developer registration is done, it is a one time 5 USD fee at the
[developer dashboard](https://chrome.google.com/webstore/devconsole).

## Listing

**Name.** Eternal Summary

**Category.** Productivity

**Short description**, 132 characters maximum. The one below is 87:

> Summarize any page or selection, then ask follow-up questions, without leaving the tab.

**Detailed description:**

> Eternal Summary reads the page you are on and gives you back the gist, beside
> the article rather than on top of it.
>
> - One click on the toolbar icon and the page comes back summarized.
> - Every summary carries numbered footnotes quoting the page. Click one and the
>   article scrolls to that passage and highlights it.
> - It tells you whether a page is worth your time: read, skim, or skip, with one
>   short clause saying what decides it.
> - Highlight any passage for a summary of just that passage, in a card anchored
>   to the text it is about.
> - Ask follow-up questions in a real thread. Answers cite the page where the
>   page answers, and say plainly when they are drawing on general knowledge.
> - Four styles: summary, bullets, key points, plain English.
> - Answers in thirteen languages, while source snippets stay in the page's own
>   words so they can still be found on the page.
> - Panel on either side at three widths, selection card at three sizes.
>
> No account, no tracking, no analytics. Summaries are cached on your own device
> for thirty minutes and can be cleared at any time.
>
> Open source: https://github.com/Alitleis123/Eternal-Summary

**Privacy policy URL.** https://alitleis123.github.io/Eternal-Summary/privacy.html

**Screenshots.** `docs/store/`, in order. Suggested captions:

1. `1-panel.png` - A summary beside the article, with the passages it drew on.
2. `2-bullets.png` - Four styles. Switching re-reads the page.
3. `3-highlight.png` - Select any passage and the Summarize button comes to it.
4. `4-selection.png` - The card is about that passage alone.

---

## Permission justifications

The dashboard asks for one per permission. Reviewers reject vague answers, so
each says what breaks without it.

**`activeTab`**
> Used to read the text of the page the user is acting on, at the moment they
> click the toolbar icon or press the keyboard shortcut. Without it the
> extension cannot obtain the text it summarizes.

**`scripting`**
> Used once, in background.js, to inject the content script into a tab that was
> already open before the extension was installed or updated. A manifest content
> script only auto-injects into pages loaded afterwards, so without this the
> toolbar icon does nothing on every tab the user already had open. The code
> tries to message the tab first and only injects when that message fails.
>
> Version 1.0 of this extension declared this permission without using it, which
> was rejected under Use of Permissions, correctly. The call was added in a later
> version, and the published version uses it.

**`storage`**
> Used to hold the user's settings, panel side and width, summary format,
> language, and to cache a summary for thirty minutes so that reopening a page
> does not repeat the request. Local to the device. Nothing is synced.

**Host permission, the backend origin**
> The extension sends page text to its own backend, which holds the API key and
> forwards the request to Gemini. The key cannot be shipped in an extension, so
> this single origin is the only host the extension contacts.

**Broad site access, `<all_urls>` content script**
> The extension summarizes whatever the user is reading, so it cannot know in
> advance which sites that will be. The content script is also what places the
> Summarize button next to a highlight, which has to be present before the user
> selects anything, so it cannot be injected on demand after a click.
>
> The script does nothing until the user acts. It reads no page text and makes
> no network request unless the toolbar icon is clicked, the shortcut is
> pressed, or text is highlighted and the Summarize button is used.

**Single purpose**
> Summarizing the page the user is reading and answering questions about it.

**Remote code**
> No. All code is in the package. The extension makes network requests for
> summaries but never loads or executes code from a remote source.

---

## Review

Broad host permissions mean manual review, and an update is reviewed again.
Days to weeks, not hours. Version 1.0 was rejected under Use of Permissions for
declaring `scripting` without calling it. The other common cause of rejection is
a permission justification that restates the permission instead of explaining
the need, which is what the answers above are written to avoid.

## Now that it is public

Strangers call the Fly backend on the Gemini key behind it. The rate limit is 30
requests per minute per IP, which stops one abuser and not a thousand ordinary
users. Keep a quota alert on the key, and decide in advance what happens if this
gets popular.
