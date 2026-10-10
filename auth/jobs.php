<?php
require_once __DIR__ . '/company-logos.php';
function fetchFeed(string $url, array $headers = []): array {
    $curl = curl_init($url);
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'Jobify/1.0 (job discovery; source attribution)']);
    $body = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    if ($body === false || $status !== 200) throw new RuntimeException('Job feed unavailable');
    $data = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new RuntimeException('Unexpected feed');
    return $data;
}
function cachedFeed(string $key, string $url, array $headers = [], int $ttl = 21600): array {
    $file = __DIR__ . '/runtime/feed-' . hash('sha256', $key) . '.json';
    if (is_file($file) && time() - filemtime($file) < $ttl) return json_decode(file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
    $lock = fopen($file . '.lock', 'c');
    if (!$lock) throw new RuntimeException('Feed cache unavailable');
    flock($lock, LOCK_EX);
    try {
        if (is_file($file) && time() - filemtime($file) < $ttl) return json_decode(file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
        $data = fetchFeed($url, $headers);
        file_put_contents($file, json_encode($data, JSON_THROW_ON_ERROR), LOCK_EX); return $data;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
function roleFor(string $title): string {
    $rules = ['Virtual assistance' => '/virtual assistant|executive assistant|office assistant|administrative|\bVA\b/i', 'Development & IT' => '/developer|engineer|software|programmer|devops|\bIT\b|data scientist/i', 'Design & creative' => '/design|creative|video|editor|writer|content/i', 'Customer support' => '/support|customer|call center|service representative/i', 'Sales & marketing' => '/sales|marketing|SEO|social media|growth|advertising/i', 'Finance & operations' => '/accountant|finance|bookkeep|operations|project manager|recruit|human resources/i'];
    foreach ($rules as $role => $pattern) if (preg_match($pattern, $title)) return $role;
    return 'Other roles';
}
function safeJobUrl(mixed $url): string {
    return is_string($url) && filter_var($url, FILTER_VALIDATE_URL) && in_array(parse_url($url, PHP_URL_SCHEME), ['https','http'], true) ? $url : '';
}
function jobDescription(mixed $html): string {
    if (!is_string($html)) return '';
    $html = preg_replace('/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/i', '', $html);
    $html = preg_replace('/<li\b[^>]*>/i', "\n- ", $html);
    $html = preg_replace('/<\/?(?:p|div|h[1-6]|ul|ol|br|section)\b[^>]*>/i', "\n", $html);
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = str_replace("\xC2\xA0", ' ', $text);
    $text = preg_replace('/\r\n?/', "\n", $text);
    $text = preg_replace('/[ \t]+/', ' ', $text);
    $text = preg_replace('/[ \t]*\n[ \t]*/', "\n", $text);
    return mb_substr(trim(preg_replace('/\n{3,}/', "\n\n", $text)), 0, 60000);
}
function employmentType(mixed $value): string {
    $key = is_string($value) ? preg_replace('/[^a-z]/', '', strtolower($value)) : '';
    return ['fulltime' => 'Full-time', 'parttime' => 'Part-time', 'contract' => 'Contract', 'contractor' => 'Contract', 'freelance' => 'Freelance', 'intern' => 'Internship', 'internship' => 'Internship', 'temporary' => 'Temporary'][$key] ?? 'Not specified';
}
function jobsRequest(string $path): never {
    global $config;
    if (in_array($path, ['/api/jobs/news', '/api/jobs/article'], true)) { require __DIR__ . '/news.php'; newsRequest($path); }
    if ($path !== '/api/jobs/search') respond(['error' => 'Not found'], 404);
    $source = is_string($_GET['source'] ?? null) ? $_GET['source'] : 'remotive';
    $query = is_string($_GET['q'] ?? null) ? mb_substr(trim($_GET['q']), 0, 120) : '';
    $publishers = ['indeed' => 'Indeed', 'jobstreet' => 'JobStreet', 'onlinejobs' => 'OnlineJobs.ph', 'linkedin' => 'LinkedIn'];
    $publisher = $publishers[$source] ?? '';
    if ($publisher !== '' && $config['jsearch_api_key'] === '') {
        $term = rawurlencode($query ?: 'virtual assistant');
        $links = ['indeed' => 'https://ph.indeed.com/jobs?q=' . $term . '&l=Philippines', 'jobstreet' => 'https://ph.jobstreet.com/jobs?keywords=' . $term, 'onlinejobs' => 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=' . $term, 'linkedin' => 'https://www.linkedin.com/jobs/search/?keywords=' . $term . '&location=Philippines'];
        respond(['jobs' => [], 'mode' => 'external', 'source' => $publisher, 'configured' => false, 'searchUrl' => $links[$source], 'message' => 'Search ' . $publisher . ' on its official website. Live imported results require a configured JSearch API key.']);
    }
    if ($publisher !== '') $source = 'jsearch';
    try {
        $jobs = [];
        if ($source === 'jsearch') {
            if ($config['jsearch_api_key'] === '') respond(['jobs' => [], 'configured' => false, 'source' => 'JSearch', 'message' => 'Philippine job search is not connected yet. Browse the official source links below.']);
            if (!currentUser(db())) respond(['error' => 'Sign in to search the connected Philippine feed.'], 401);
            throttle(db(), 'job-search');
            session_write_close();
            $url = 'https://jsearch.p.rapidapi.com/search?' . http_build_query(['query' => ($query ?: 'jobs') . ' in Philippines' . ($publisher ? ' via ' . $publisher : ''), 'country' => 'ph', 'num_pages' => 1]);
            $feed = cachedFeed('jsearch:' . $query . ':' . $publisher, $url, ['X-RapidAPI-Key: ' . $config['jsearch_api_key'], 'X-RapidAPI-Host: jsearch.p.rapidapi.com'], 3600);
            foreach ($feed['data'] ?? [] as $row) {
                if ($publisher && stripos(($row['job_publisher'] ?? '') . ' ' . ($row['job_apply_link'] ?? ''), str_replace('.ph', '', $publisher)) === false) continue;
                $url = safeJobUrl($row['job_apply_link'] ?? ''); $direct = (bool)($row['job_apply_is_direct'] ?? false);
                foreach ($row['apply_options'] ?? [] as $option) { if (!empty($option['is_direct']) && safeJobUrl($option['apply_link'] ?? '')) { $url = safeJobUrl($option['apply_link']); $direct = true; break; } }
                if (!$url) continue;
                $jobs[] = ['id' => $row['job_id'] ?? hash('sha256', $url), 'title' => $row['job_title'] ?? '', 'description' => jobDescription($row['job_description'] ?? ''), 'company' => $row['employer_name'] ?? '', 'location' => implode(', ', array_filter([$row['job_city'] ?? '', $row['job_country'] ?? ''])), 'role' => roleFor($row['job_title'] ?? ''), 'url' => $url, 'source' => $row['job_publisher'] ?? 'JSearch', 'salary' => '', 'date' => $row['job_posted_at_datetime_utc'] ?? '', 'logo' => companyLogo($row['employer_name'] ?? '', safeJobUrl($row['employer_logo'] ?? '')), 'employmentType' => employmentType($row['job_employment_type'] ?? ''), 'workMode' => ($row['job_is_remote'] ?? false) ? 'Remote / WFH' : 'Check listing', 'direct' => $direct];
            }
        } elseif ($source === 'remotive') {
            $feed = cachedFeed('remotive', 'https://remotive.com/api/remote-jobs');
            foreach ($feed['jobs'] ?? [] as $row) {
                $title = $row['title'] ?? ''; $company = $row['company_name'] ?? '';
                if ($query && !str_contains(mb_strtolower($title . ' ' . $company . ' ' . ($row['category'] ?? '')), mb_strtolower($query))) continue;
                $url = safeJobUrl($row['url'] ?? ''); if (!$url) continue;
                $jobs[] = ['id' => (string)$row['id'], 'title' => $title, 'description' => jobDescription($row['description'] ?? ''), 'company' => $company, 'location' => $row['candidate_required_location'] ?: 'Check listing', 'role' => roleFor($title), 'url' => $url, 'source' => 'Remotive', 'salary' => $row['salary'] ?? '', 'date' => $row['publication_date'] ?? '', 'logo' => companyLogo($company, safeJobUrl($row['company_logo'] ?? '')), 'employmentType' => employmentType($row['job_type'] ?? ''), 'workMode' => 'Remote / WFH', 'direct' => false];
            }
        } elseif ($source === 'arbeitnow') {
            $feed = cachedFeed('arbeitnow-v1', 'https://www.arbeitnow.com/api/job-board-api');
            foreach ($feed['data'] ?? [] as $row) {
                $title = $row['title'] ?? ''; $company = $row['company_name'] ?? '';
                if ($query && !str_contains(mb_strtolower($title . ' ' . $company . ' ' . implode(' ', $row['tags'] ?? [])), mb_strtolower($query))) continue;
                $url = safeJobUrl($row['url'] ?? ''); if (!$url) continue;
                $type = 'Not specified'; foreach ($row['job_types'] ?? [] as $value) { $mapped = employmentType($value); if ($mapped !== 'Not specified') { $type = $mapped; break; } }
                $jobs[] = ['id' => 'arbeitnow:' . ($row['slug'] ?? ''), 'title' => $title, 'description' => jobDescription($row['description'] ?? ''), 'company' => $company, 'location' => $row['location'] ?? 'Check listing', 'role' => roleFor($title), 'url' => $url, 'source' => 'Arbeitnow', 'salary' => '', 'date' => isset($row['created_at']) ? gmdate('c', (int)$row['created_at']) : '', 'logo' => companyLogo($company, ''), 'employmentType' => $type, 'workMode' => !empty($row['remote']) ? 'Remote / WFH' : 'Check listing', 'direct' => false];
            }
        } else respond(['error' => 'Unknown job source'], 422);
        respond(['jobs' => array_slice($jobs, 0, 100), 'configured' => true, 'source' => $source === 'remotive' ? 'Remotive' : ($source === 'arbeitnow' ? 'Arbeitnow' : 'JSearch'), 'message' => $source === 'arbeitnow' ? 'Free listings from Arbeitnow, mostly Europe. Check country, language and remote-work requirements before applying.' : ($source === 'remotive' ? 'Remote listings from Remotive, delayed by 24 hours. Check each listing’s location requirements before applying.' : 'Philippine results via JSearch. Availability varies by publisher.')]);
    } catch (Throwable $e) { respond(['error' => 'The job feed is temporarily unavailable. Use the official source links or try again later.'], 502); }
}

