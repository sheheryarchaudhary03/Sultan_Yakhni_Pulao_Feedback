# Sultan Yakhni Pulao Feedback

Customer feedback form for Sultan Yakhni Pulao, in English and Urdu. It is one page
(`index.html`) plus the logo, with no build step: host the folder on any static host.

## How it works

1. **Visit:** the customer picks their branch and how they got their order (dine-in,
   takeaway or delivery). Tapping the order type moves straight to the next page.
2. **Review:** six required questions for that order type.
3. **Optional:** more about the food, the visit or delivery, and the customer (how they
   heard about Sultan, offers sign-up, comments). **Send now** on step 2 skips this page.

## Branch links for QR codes

Add `#<branch id>` to the form link to preselect a branch, so each branch can print its
own QR code:

| Branch | Link ending |
|---|---|
| SYP Paka Garah, Kashmir Rd. | `#paka-garah` |
| SYP Kashmir Park | `#kashmir-park` |
| SYP Daska | `#daska` |
| SYP Akbarabad | `#akbarabad` |
| Sultan Johar Town | `#johar-town` |

Add or rename branches in the `BRANCHES` list near the top of the script in `index.html`.

## Saving responses

Responses are not stored yet. Set `SUBMIT_URL` in `index.html` to a Google Apps Script
web-app URL, or any endpoint that accepts a JSON `POST`. Until then, each response is
printed to the browser console.

## Run on your computer

```bash
python -m http.server 8010
```

Then open http://localhost:8010.
