<?php
function newsSummary(array $item): array {
    $image = safeJobUrl($item['cover_image'] ?? $item['social_image'] ?? '');
    return ['id' => (int)$item['id'], 'title' => $item['title'] ?? '', 'url' => safeJobUrl($item['url'] ?? ''), 'source' => 'DEV Community', 'author' => $item['user']['name'] ?? '', 'date' => $item['published_at'] ?? '', 'image' => $image, 'description' => $item['description'] ?? '', 'minutes' => (int)($item['reading_time_minutes'] ?? 3), 'tags' => (is_array($item['tag_list'] ?? null) ? array_values($item['tag_list']) : explode(',', $item['tag_list'] ?? ''))];
}
function newsRequest(string $path): never {
    try {
        if ($path === '/api/jobs/news') {
            $feed = cachedFeed('dev-career-news-v1', 'https://dev.to/api/articles?tags=career,remotework,productivity&per_page=24', ['Accept: application/vnd.forem.api-v1+json'], 3600);
            $articles = [];
            foreach ($feed as $item) if (is_array($item) && isset($item['id']) && safeJobUrl($item['url'] ?? '')) $articles[] = newsSummary($item);
            respond(['articles' => $articles]);
        }
        $id = filter_var($_GET['id'] ?? '', FILTER_VALIDATE_INT);
        if (!$id || $id < 1 || $id > 100000000) respond(['error' => 'Invalid article.'], 422);
        $article = cachedFeed('dev-article:' . $id, 'https://dev.to/api/articles/' . $id, ['Accept: application/vnd.forem.api-v1+json'], 86400);
        respond(['article' => array_merge(newsSummary($article), ['body' => mb_substr($article['body_html'] ?? '', 0, 300000)])]);
    } catch (Throwable $e) { respond(['error' => 'This article is temporarily unavailable. Please try again later.'], 502); }
}
