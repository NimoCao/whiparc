# Whiparc Transactional & Newsletter Email — Configuration Pass (instructions for Claude Code)

**Read this whole file before touching anything.** The newsletter/contact/inbound email backend (`apps/api/mailer.go`, `mailer_capture.go`, `email_capture.go`, `inbound_email.go`) is already fully built — double opt-in newsletter signup, unsubscribe, contact-form acknowledgement, owner notifications, a provider-agnostic inbound webhook — and it's good work: sanitized inputs, a clean `EmailSender` interface with Console/Resend/SMTP implementations, honeypot on the newsletter form, constant-time webhook secret comparison. **This is a configuration and wiring pass, not a rebuild.** Do not rewrite `mailer.go`/`mailer_capture.go`/`email_capture.go`/`inbound_email.go` unless a step below says to.

## 1. Context: how mail actually flows for whiparc.com today

This is real, already live — don't duplicate or second-guess it:

- **DNS**: `whiparc.com`'s nameservers point at Vercel (`ns1.vercel-dns.com` / `ns2.vercel-dns.com`), so Vercel's own DNS panel (Project → Domains → whiparc.com) is the one place all records live — there is no separate Cloudflare or Hostinger DNS zone to worry about.
- **Inbound mail** is handled by **ImprovMX** (free plan — forwarding only, no SMTP sending, no webhook capability): two MX records at the **root** of `whiparc.com` (`mx1.improvmx.com` priority 10, `mx2.improvmx.com` priority 20) plus one SPF TXT record at the root (`v=spf1 include:spf.improvmx.com ~all`). All three must have an **empty Name field** in Vercel (root domain, not a subdomain) — if you ever see a record named `mail-forwarding-1`/`mail-forwarding-2`/`mail-forwarding-spf` instead of blank, that's a prior misconfiguration, already corrected; don't reintroduce it.
- **Four live aliases**, each forwarding to the founder's personal Gmail via ImprovMX: `hello@whiparc.com`, `founders@whiparc.com`, `support@whiparc.com`, `noreply@whiparc.com`. These are real, receiving mailboxes today, not placeholders.
- **Outbound, for the founder personally**: Gmail's own "Send mail as" feature, configured to send through Gmail's SMTP (`smtp.gmail.com` with an app password) — this is for the founder composing/replying as these addresses **by hand in his own Gmail client**. It is a personal-mailbox feature, not an API, and has nothing to do with the app's own transactional email sending — never point `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` at Gmail or at the founder's personal credentials for app-level sending (wrong sender identity, Gmail's consumer sending limits, and mixing a personal account into app secrets).

**The consequence for this codebase**: ImprovMX is receive-only and has no API/webhook. The app's own outbound sending (newsletter confirmations, contact acknowledgements, verification/invite/password-reset emails — everything `EmailSender` already implements) needs its **own** separate provider, configured through `RESEND_API_KEY` or `SMTP_*`, same as `NewEmailSender()` in `mailer.go` already expects. Nothing about ImprovMX changes that; they're two independent concerns that happen to share the same domain.

## 2. What to actually configure

**Pick Resend as the outbound provider.** The branded HTML templates in `mailer_capture.go` (`brandedEmailHTML`) and the dedicated `ResendMailer` methods are clearly built with Resend as the intended production path, and `NewEmailSender()` already prefers `RESEND_API_KEY` over `SMTP_HOST` when both are set — so this is the path of least resistance, not a new decision.

1. Create a Resend account, add `whiparc.com` as a sending domain.
2. Resend will give you its own DKIM CNAME record(s) to verify the domain — add those in Vercel's DNS panel as new rows (root or a Resend-specified subdomain, whatever their dashboard shows), alongside the existing ImprovMX MX/SPF rows. **Do not delete or modify the existing ImprovMX MX records** — inbound mail still needs those.
3. Resend will also ask you to add its own SPF `include` value. **SPF allows only one TXT record of type `v=spf1` per domain** — do not add a second SPF TXT record. Instead, edit the existing one so both providers are included in a single record, e.g.:
   ```
   v=spf1 include:spf.improvmx.com include:_spf.resend.com ~all
   ```
   (use whatever exact include value Resend's dashboard shows you — don't guess the hostname). Two competing SPF TXT records is invalid and will make mail from *both* providers look unauthenticated.
4. In the API's production environment variables, set:
   - `RESEND_API_KEY` = the key from Resend.
   - `EMAIL_FROM` = `Whiparc <noreply@whiparc.com>` (this already matches the hardcoded fallback in `mailer.go`/`inbound_email.go`'s `isOwnSenderAddress`, so leaving it unset would also work, but set it explicitly for clarity).
5. **Set `CONTACT_NOTIFY_EMAIL`** to one of the live, ImprovMX-forwarded aliases — `support@whiparc.com` is the natural choice (`hello@whiparc.com` is also fine, founder's call). This is the one piece of required wiring: `notifyOwner()` in `email_capture.go` currently has nowhere to send contact-form and inbound-mail notifications (it logs "stored but not forwarded" when this is unset), and setting it closes the loop — Resend sends the notification to `support@whiparc.com`, ImprovMX forwards that into the founder's real Gmail inbox, no new code needed.
6. Leave **`INBOUND_EMAIL_SECRET` unset, and leave `POST /api/inbound/email` unconfigured.** That endpoint exists for a future provider that can POST inbound mail as a webhook (the code's own comment calls out Postmark's JSON shape as an example of what it already tolerates) — ImprovMX's free plan cannot do this at all, so there is nothing to wire it to right now. Don't build a shim or try to make ImprovMX satisfy this endpoint; it's architecturally a different kind of provider. Revisit this only if the project later moves off ImprovMX to a provider with inbound webhooks.

## 3. What not to do

- Don't touch `mailer.go`/`mailer_capture.go`'s `ConsoleMailer`/`ResendMailer`/`SMTPMailer` implementations — they're correct and already handle this.
- Don't add a Gmail SMTP path as a `SMTPMailer` option for production sending — Gmail is the founder's personal mailbox client, not an app-sending credential.
- Don't add a second SPF TXT record for Resend — merge into the existing one (see §2.3).
- Don't modify or remove the ImprovMX MX records while setting any of this up.
- Don't wire `INBOUND_EMAIL_SECRET`/`/api/inbound/email` to ImprovMX — it can't call webhooks on the free plan; leave that endpoint dormant.
- The `placeholder="you@company.com"` / `"teammate@example.com"` / `"you@newdomain.com"` strings in `ContactForm.tsx`, `AccountPageV2.tsx`, `LoginPageV2.tsx`, `forgot-password/page.tsx`, `TeamPageV2.tsx` are just greyed-out input hints for a user typing their *own* email — not hardcoded sender/receiver addresses. Leave them as they are; nothing to fix there.

## 4. Verification checklist

- [ ] Resend shows `whiparc.com` as a verified sending domain (DKIM passed).
- [ ] The single SPF TXT record includes both `spf.improvmx.com` and Resend's include value, and an SPF checker (e.g. mxtoolbox.com) shows no "too many" or duplicate-record warnings.
- [ ] `RESEND_API_KEY` and `EMAIL_FROM` are set in production; a real newsletter signup via the footer form (`NewsletterForm.tsx` → `/api/newsletter/subscribe`) results in a confirmation email arriving at a real inbox, sent from `noreply@whiparc.com`, not logged to console.
- [ ] `CONTACT_NOTIFY_EMAIL=support@whiparc.com` (or `hello@`) is set; submitting the real `/contact` form results in an acknowledgement to the sender *and* a notification landing in the founder's Gmail (via ImprovMX forwarding of `support@`/`hello@`).
- [ ] `INBOUND_EMAIL_SECRET` remains unset; `POST /api/inbound/email` still returns 503, confirming it's deliberately off.
- [ ] ImprovMX's dashboard still shows the domain verified (MX + SPF green) after the SPF record edit in §2.3 — a shared-record mistake here would quietly break inbound forwarding, so re-check it, not just Resend's side.
