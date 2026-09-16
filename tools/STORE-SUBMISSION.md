# Chrome Web Store submission

Everything the dashboard asks for, written out so a resubmission does not mean
reconstructing it from memory. Nothing here ships in the extension.

Build the upload with `npm run package`, which writes
`eternal-summary-<version>.zip` containing only the nine files the manifest
names. Listing images come from `npm run shots`, which writes four 1280x800
captures to `docs/store/`.

---

## Before you upload

- [ ] Register as a developer, one time, 5 USD, at the [developer dashboard](https://chrome.google.com/webstore/devconsole)
- [ ] `npm test` and `npm run check` pass
- [ ] `npm run package` and `npm run shots`
- [ ] Bump `version` in `manifest.json` if this is not the first submission, the
      store rejects a version it has already seen

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
> Used to inject the panel into the current tab when the user opens it. The
> interface is rendered in a shadow root on the page so that it can sit beside
> the article and scroll with it, which an extension popup cannot do.

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

## What to expect

Broad host permissions mean manual review. Days to weeks, not hours. The most
common cause of rejection here is a permission justification that restates the
permission instead of explaining the need, which is what the answers above are
written to avoid.

## Before this gets traffic

Publishing means strangers calling the Fly backend on your Gemini key. The rate
limit is 30 requests per minute per IP, which stops one abuser and not a
thousand ordinary users. Worth setting a quota alert on the key, and deciding
in advance what happens if it gets popular.
