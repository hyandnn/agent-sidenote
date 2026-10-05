# Adapter fixtures

These are hand-written, minimal HTML fixtures with synthetic content. They model the selectors already supported by the extension and include nested wrappers, alternate bubble/class markup, controls, hidden messages, sidebars and Gemini thoughts. They are not captures of authenticated live conversations.

`adapters.test.js` runs the production adapters and selection handlers against these DOMs. `site_lifecycle.test.js` checks note creation, conversation scoping and close/restore behavior on all three site URLs. JSDOM supplies the DOM; layout measurements and Chrome APIs are mocked.

## Live browser acceptance

After reloading the unpacked extension and refreshing each supported site:

1. Select text in an assistant reply. Check that the quote, whole reply and preceding user/assistant context are correct; copy/share controls and Gemini thoughts must not appear.
2. Select text in the composer, sidebar, an existing sidenote, or across two messages. No selection button should appear.
3. Switch conversations through the site's navigation, then return. Notes should stay on their own URL; close a note, use **恢复当前页便签**, and refresh to check restoration.
4. Test API authorization with a configured endpoint: reject the prompt, grant it, revoke it, switch hosts and save Mock mode. Rejected saves must retain the previous settings, and missing/revoked access must prevent requests.

When a live DOM change breaks an adapter, preserve only the relevant markup and selector attributes, replace conversation text/URLs/IDs with synthetic values, and add a regression case. Remove account data, tokens and unrelated application state before committing a new fixture.
