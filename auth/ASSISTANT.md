# Joblink assistant setup

Gemini is the default AI provider. The connector uses Google's generateContent API, with `gemini-3.1-flash-lite` as the configurable default model. Google lists a free tier for this model; actual availability and quotas depend on your AI Studio project. No automatic fallback to paid OpenAI calls is performed.

## Gemini configuration

Create an API key in [Google AI Studio](https://aistudio.google.com/api-keys) using a free-tier project, then fill in the existing fields in `auth/config.local.php`:

```php
'assistant_provider' => 'gemini',
'gemini_api_key' => 'YOUR_GEMINI_API_KEY',
'gemini_model' => 'gemini-3.1-flash-lite',
'gemini_account_context' => 'disabled',
```

Keep the key in the private server file. Requests use the `x-goog-api-key` header; the key never enters frontend code or URL parameters. Free-tier quota errors are shown in the chat. If your Google project has paid billing enabled, provider charges can apply; the app cannot guarantee the project's billing tier.

Google's free-tier API content may be used to improve its products. By default, account-related questions are answered locally from the signed-in user's saved applications, interview statuses, tasks and upcoming calendar events. These records are not sent to Gemini. To explicitly opt into generated account answers, set `gemini_account_context` to `enabled`; this sends the relevant account snapshot along with the question.

General questions and recent chat context are sent to Gemini when the key is configured. Passwords, API keys, email addresses, notes and other users' records are excluded from account context. The assistant is read-only and never submits job applications.

Gemini web grounding is omitted to keep this setup compatible with the free tier. The assistant explains general concepts and should not claim current economic statistics are verified. Account summaries work even with an empty Gemini key.

## Keyboard

- Enter sends a message.
- Shift+Enter adds a new line.
- Enter during IME composition does not send prematurely.
- Repeated Enter presses while waiting do not send duplicate requests.

## Optional OpenAI provider

To use the existing OpenAI connector instead, set `assistant_provider` to `openai` and configure `openai_api_key` and `openai_model`. This is an explicit selection, never an automatic fallback.

## Local services and files

- Account/workspace: port 8081
- Jobs/news: port 8082
- Assistant: port 8083
- Frontend: http://localhost:3000

`start-preview.ps1` starts the services. The assistant requires sign-in, CSRF and origin checks, bounded input/output and rate limits for model calls.

`auth/gemini.php` handles Gemini requests and text parsing. `auth/assistant.php` selects the provider. `auth/assistant-account.php` builds account-scoped summaries. `shared/components/AssistantWidget.astro` supplies the interface.

Keyboard behavior, Gemini response parsing and missing-key handling were tested. A live Gemini response has not been tested because the API key is currently empty.

Official references: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key), [generateContent](https://ai.google.dev/api/generate-content).
