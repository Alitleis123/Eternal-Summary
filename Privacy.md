# Eternal Summary privacy policy

Last updated 24 October 2026

Eternal Summary does not collect, store, or sell personal data.

## What gets sent, and when

Nothing is sent anywhere until you ask for something. When you open the panel, ask a question, or use the Summarize button on a highlight, the extension sends the relevant text to its backend, which forwards it to the Gemini API to produce a response:

- Opening the panel on a page sends up to 6,000 characters of that page's visible text.
- Summarizing a highlight sends only the highlighted text.
- Asking a question sends your question, the recent messages in that conversation, the same page text the summary used, and any text you have highlighted on the page.
- If you pick a summary language in the settings, its two-letter code goes with each request.

The backend keeps none of this. Text is used to generate the response and is discarded when the request finishes. Its logs record the size, mode and language of each request and any error, never the text. Requests are rate limited per IP address, which is held in memory for one minute and never written down.

## What stays on your device

Summaries are cached in your browser's extension storage for thirty minutes so that reopening a page you already summarized does not cost another request. Once a summary is older than that, it is deleted the next time you open the panel. Your settings are stored the same way. Neither leaves your device. Clear saved summaries from the gear in the panel header, or remove both by clearing the extension's data.

## What is never collected

No accounts, no browsing history, no analytics, no advertising, no tracking, and no profiling. The extension does nothing in the background and makes no requests on pages you have not acted on.

## Why it can read every site

The extension asks for access to all sites because it cannot know in advance which page you will want summarized, and the Summarize button has to already be there when you highlight something. Access is used only on the page in the tab you are acting on, and only when you click or press the shortcut. No page is read in the background.

## Third parties

The backend runs on Fly.io, so requests pass through Fly's servers on their way to it. Text you submit is processed by Google's Gemini API under Google's terms. No other third party receives it.

## Contact

Questions about this policy: alitleis2006icloud@gmail.com
