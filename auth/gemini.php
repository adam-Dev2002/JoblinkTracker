<?php
function geminiAnswerText(array $result): string {
    $text = [];
    foreach ($result['candidates'][0]['content']['parts'] ?? [] as $part) if (empty($part['thought']) && is_string($part['text'] ?? null)) $text[] = $part['text'];
    return trim(implode("\n", $text));
}
function assistantAccountFallback(?array $account, bool $limit): never {
    if ($account === null) respond(['error' => $limit ? 'AI request limit reached. Please try later.' : 'AI is temporarily unavailable. Please try later.'], $limit ? 429 : 502);
    $notice = $limit ? 'You have exceeded the limit for AI account-summary questions. Here is your local account summary instead.' : 'AI account summaries are temporarily unavailable. Here is your local account summary instead.';
    respond(['answer' => $notice . "\n\n" . accountSummary($account), 'sources' => [], 'mode' => 'account-summary', 'fallback' => true]);
}
function geminiReply(array $input, string $instructions, ?array $account = null): never {
    global $config;
    if (!preg_match('/^[a-zA-Z0-9.-]+$/', $config['gemini_model'])) respond(['error' => 'Check the configured Gemini model.'], 503);
    $contents = array_map(fn($message) => ['role' => $message['role'] === 'assistant' ? 'model' : 'user', 'parts' => [['text' => $message['content']]]], $input);
    $payload = ['systemInstruction' => ['parts' => [['text' => $instructions . ' Live web search is not enabled. Do not claim current economic statistics are verified; explain uncertainty and suggest primary sources.']]], 'contents' => $contents, 'generationConfig' => ['maxOutputTokens' => 1600]];
    $curl = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($config['gemini_model']) . ':generateContent');
    curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 55, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $config['gemini_api_key']], CURLOPT_POSTFIELDS => json_encode($payload, JSON_THROW_ON_ERROR)]);
    $body = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    if ($body === false || $status !== 200) {
        error_log('Joblink Gemini provider status: ' . $status);
        if ($status === 429) assistantAccountFallback($account, true);
        if ($account !== null) assistantAccountFallback($account, false);
        respond(['error' => 'Gemini is unavailable. Check the API key and model in your local configuration, then try again.'], 502);
    }
    try { $result = json_decode($body, true, 64, JSON_THROW_ON_ERROR); $answer = geminiAnswerText($result); }
    catch (Throwable $e) { assistantAccountFallback($account, false); }
    if ($answer === '' && $account !== null) assistantAccountFallback($account, false);
    if ($answer === '') respond(['error' => 'Gemini returned no text. Please rephrase your question.'], 502);
    respond(['answer' => $answer, 'sources' => [], 'mode' => 'gemini']);
}
