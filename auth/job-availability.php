<?php
function closedJobRow(array $row): bool {
    foreach (['availability', 'status', 'job_status', 'jobStatus'] as $field) if (preg_match('/^(closed|filled|full|expired|inactive|unavailable|removed|deleted|archived|cancelled|canceled)$/i', trim((string)($row[$field] ?? '')))) return true;
    foreach (['active', 'is_active', 'job_is_active', 'acceptingApplications'] as $field) if (array_key_exists($field, $row) && in_array($row[$field], [false, 0, 'false'], true)) return true;
    foreach (['closed', 'filled', 'expired', 'is_closed', 'job_is_expired'] as $field) if (in_array($row[$field] ?? null, [true, 1, 'true'], true)) return true;
    if (($row['totalJobOpenings'] ?? null) === 0 || ($row['vacancies'] ?? null) === 0) return true;
    foreach (['validThrough', 'expires_at', 'expiration_date', 'job_valid_through', 'job_offer_expiration_datetime_utc'] as $field) {
        $value = $row[$field] ?? '';
        if (!$value) continue;
        $deadline = strtotime(preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value . 'T23:59:59Z' : $value);
        if ($deadline !== false && $deadline < time()) return true;
    }
    $title = html_entity_decode(strip_tags($row['title'] ?? $row['jobTitle'] ?? $row['job_title'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = $title . ' ' . html_entity_decode(strip_tags($row['description'] ?? $row['jobDescription'] ?? $row['job_description'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    if (preg_match('/\b(?:position|role|job|vacancy)\s+(?:filled|closed|expired)\b/i', $title)) return true;
    $text = preg_replace('/\b(?:until|before)\s+(?:the\s+)?(?:job|position)\s+is\s+(?:closed|filled)\b/i', '', $text);
    return preg_match('/^(?:\[|\()?\s*(?:closed|filled|expired|hiring closed)\s*(?:\]|\)|[-:]|$)/i', $title) || preg_match('/\b(?:this\s+)?(?:job(?:\s+(?:post(?:ing)?|listing|opening))?|advert|position|vacancy|role)\s+(?:(?:has|have)\s+(?:already\s+)?been|is|was)\s+(?:already\s+)?(?:closed|filled|full|expired|removed|no longer available)\b|\b(?:no longer|not)\s+accepting\s+(?:new\s+)?applications\b|\bapplications?\s+(?:are\s+|is\s+)?(?:closed|full)\b|\ball\s+(?:positions|vacancies|slots)\s+(?:have been\s+|are\s+)?filled\b/i', $text);
}
